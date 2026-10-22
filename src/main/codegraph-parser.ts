import ts from 'typescript'
import type { CodeBinding, CodeSymbol, ParsedCodeFile } from '../shared/codegraph.ts'

const supportedExtensions = /\.(?:[cm]?[jt]sx?)$/i
const entryLimit = 20_000
const sourceLimit = 1_048_576

interface Scope {
  id: string
  parentId?: string
  ownerSymbolId?: string
  kind: 'module' | 'function' | 'block' | 'class'
}

interface Context {
  scope: Scope
  owner: CodeSymbol
  names: string[]
  classSymbol?: CodeSymbol
  staticMember?: boolean
  dynamic?: boolean
}

function hasModifier(node: ts.Node, modifier: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((item) => item.kind === modifier)
  )
}

function expressionName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text
  if (node.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (node.kind === ts.SyntaxKind.SuperKeyword) return 'super'
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return expressionName(node.expression)
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = expressionName(node.expression)
    return base ? `${base}.${node.name.text}` : undefined
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    const base = expressionName(node.expression)
    return base ? `${base}.${node.argumentExpression.text}` : undefined
  }
  return undefined
}

function declarationName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name)
    ? name.text
    : undefined
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((item) =>
    ts.isOmittedExpression(item) ? [] : bindingNames(item.name),
  )
}

/** Parse source text only: no compiler host, module loading, or source execution. */
export function parseCodeFile(path: string, source: string): ParsedCodeFile {
  const normalizedPath = path.replaceAll('\\', '/')
  const supported = supportedExtensions.test(normalizedPath)
  const result: ParsedCodeFile = {
    path: normalizedPath,
    language: supported
      ? /\.[cm]?tsx?$/i.test(normalizedPath)
        ? 'typescript'
        : 'javascript'
      : 'unsupported',
    symbols: [],
    imports: [],
    calls: [],
    bindings: [],
    scopes: [],
    reExports: [],
    diagnostics: [],
  }
  if (!supported) return result
  if (source.length > sourceLimit) {
    result.diagnostics.push({
      line: 1,
      message: 'Source exceeds the structural parser size limit.',
    })
    return result
  }
  const scriptKind = /\.tsx$/i.test(path)
    ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(path)
      ? ts.ScriptKind.JSX
      : result.language === 'typescript'
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS
  let file: ts.SourceFile
  try {
    file = ts.createSourceFile(normalizedPath, source, ts.ScriptTarget.Latest, true, scriptKind)
  } catch {
    result.diagnostics.push({
      line: 1,
      message: 'Source syntax exceeds the structural parser nesting limit.',
    })
    return result
  }
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics
  for (const diagnostic of diagnostics?.slice(0, 100) ?? []) {
    result.diagnostics.push({
      line: file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    })
  }
  let entries = 0
  let stopped = false
  let scopeOrdinal = 0
  const ordinals = new Map<string, number>()
  const scopes = new Map<string, Scope>()
  const writes: { name: string; scopeId: string }[] = []
  const lineOf = (node: ts.Node): number =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
  function accept(): boolean {
    if (stopped) return false
    if (++entries <= entryLimit) return true
    stopped = true
    result.diagnostics.push({
      line: 1,
      message: 'Structural parser entry limit reached; file is partial.',
    })
    return false
  }
  function scope(kind: Scope['kind'], parent?: Scope, owner?: CodeSymbol): Scope {
    const item: Scope = {
      id: `${normalizedPath}::scope:${scopeOrdinal++}`,
      kind,
      ...(parent ? { parentId: parent.id } : {}),
      ...(owner ? { ownerSymbolId: owner.id } : {}),
    }
    scopes.set(item.id, item)
    if (accept()) {
      result.scopes.push({
        id: item.id,
        ...(item.parentId ? { parentId: item.parentId } : {}),
        ...(item.ownerSymbolId ? { ownerSymbolId: item.ownerSymbolId } : {}),
      })
    }
    return item
  }
  function symbol(
    node: ts.Node,
    name: string,
    kind: CodeSymbol['kind'],
    context?: Context,
    member = false,
  ): CodeSymbol {
    const qualifiedName = [...(context?.names ?? []), name].join('.')
    const ordinal = ordinals.get(qualifiedName) ?? 0
    ordinals.set(qualifiedName, ordinal + 1)
    const item: CodeSymbol = {
      id: `${normalizedPath}::${encodeURIComponent(qualifiedName)}#${ordinal}`,
      name,
      qualifiedName,
      file: normalizedPath,
      kind,
      startLine: lineOf(node),
      endLine:
        file.getLineAndCharacterOfPosition(Math.max(node.getStart(file), node.end - 1)).line + 1,
      exported: hasModifier(node, ts.SyntaxKind.ExportKeyword),
      ...(hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? { defaultExport: true } : {}),
      scopeId: context?.scope.id ?? `${normalizedPath}::scope:0`,
      ...(member && context?.classSymbol
        ? {
            memberOf: context.classSymbol.id,
            static: hasModifier(node, ts.SyntaxKind.StaticKeyword),
          }
        : {}),
    }
    if (accept()) result.symbols.push(item)
    return item
  }
  function bind(
    targetScope: Scope,
    name: string,
    kind: CodeBinding['kind'],
    target?: string,
  ): void {
    if (accept()) {
      result.bindings.push({
        scopeId: targetScope.id,
        name,
        kind,
        ...(target ? { target } : {}),
      })
    }
  }
  const moduleSymbol = symbol(file, '<module>', 'module')
  const moduleScope = scope('module', undefined, moduleSymbol)
  const root: Context = { scope: moduleScope, owner: moduleSymbol, names: [] }
  function variableScope(start: Scope): Scope {
    let current = start
    while (current.kind !== 'function' && current.kind !== 'module' && current.parentId) {
      current = scopes.get(current.parentId)!
    }
    return current
  }
  function recordWrite(node: ts.Expression, context: Context): void {
    const name = expressionName(node)
    if (name) writes.push({ name, scopeId: context.scope.id })
    else if (ts.isElementAccessExpression(node)) {
      const receiver = expressionName(node.expression)
      if (receiver) writes.push({ name: `${receiver}.*`, scopeId: context.scope.id })
    }
  }
  function functionNode(
    node: ts.FunctionLikeDeclaration,
    context: Context,
    inferredName?: string,
    member = false,
    existing?: CodeSymbol,
  ): CodeSymbol {
    const name = inferredName ?? declarationName(node.name) ?? '<anonymous>'
    const item = existing ?? symbol(node, name, member ? 'method' : 'function', context, member)
    const innerScope = scope('function', context.scope, item)
    const inner: Context = {
      ...context,
      scope: innerScope,
      owner: item,
      names: [...context.names, name],
    }
    if (!ts.isArrowFunction(node)) {
      // Ordinary nested functions have their own dynamic `this`; arrows inherit it.
      bind(
        innerScope,
        'this',
        member && context.classSymbol ? 'symbol' : 'variable',
        member ? context.classSymbol?.id : undefined,
      )
    }
    if (ts.isFunctionExpression(node) && node.name)
      bind(innerScope, node.name.text, 'symbol', item.id)
    for (const parameter of node.parameters) {
      for (const parameterName of bindingNames(parameter.name))
        bind(innerScope, parameterName, 'parameter')
    }
    for (const parameter of node.parameters) {
      if (parameter.initializer) visit(parameter.initializer, inner)
    }
    if (node.body) {
      // Parameter initializers cannot see `var` declarations from the function body.
      const bodyScope = scope('function', innerScope, item)
      visit(node.body, { ...inner, scope: bodyScope })
    }
    return item
  }
  function classNode(
    node: ts.ClassLikeDeclaration,
    context: Context,
    inferredName?: string,
  ): CodeSymbol {
    const name = inferredName ?? node.name?.text ?? 'default'
    const item = symbol(node, name, 'class', context)
    const innerScope = scope('class', context.scope, item)
    const inner: Context = {
      ...context,
      scope: innerScope,
      owner: item,
      classSymbol: item,
      names: [...context.names, name],
    }
    if (node.name) bind(innerScope, node.name.text, 'symbol', item.id)
    for (const heritage of node.heritageClauses ?? []) {
      for (const type of heritage.types) visit(type.expression, context)
    }
    for (const member of node.members) {
      if (member.name && ts.isComputedPropertyName(member.name))
        visit(member.name.expression, inner)
      if (ts.isConstructorDeclaration(member)) {
        functionNode(member, inner, 'constructor', true)
      } else if (
        ts.isMethodDeclaration(member) ||
        ts.isGetAccessor(member) ||
        ts.isSetAccessor(member)
      ) {
        const memberName = declarationName(member.name) ?? '<computed>'
        const method = functionNode(member, inner, memberName, true)
        bind(
          innerScope,
          memberName,
          ts.isMethodDeclaration(member) ? 'symbol' : 'variable',
          method.id,
        )
      } else if (ts.isPropertyDeclaration(member)) {
        const memberName = declarationName(member.name) ?? '<computed>'
        const initializer = member.initializer
        if (
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          const method = symbol(member, memberName, 'method', inner, true)
          bind(innerScope, memberName, 'symbol', method.id)
          const propertyScope = scope('block', innerScope, method)
          bind(propertyScope, 'this', 'symbol', item.id)
          functionNode(
            initializer,
            { ...inner, scope: propertyScope },
            memberName,
            ts.isArrowFunction(initializer),
            method,
          )
        } else {
          const property = symbol(member, memberName, 'variable', inner, true)
          bind(innerScope, memberName, 'variable', property.id)
          if (initializer) {
            const propertyScope = scope('block', innerScope, property)
            bind(propertyScope, 'this', 'symbol', item.id)
            visit(initializer, {
              ...inner,
              scope: propertyScope,
              owner: property,
              names: [...inner.names, memberName],
            })
          }
        }
      } else if (ts.isClassStaticBlockDeclaration(member)) {
        const staticScope = scope('block', innerScope, item)
        bind(staticScope, 'this', 'symbol', item.id)
        visit(member.body, { ...inner, scope: staticScope, staticMember: true })
      }
    }
    return item
  }
  function visit(node: ts.Node, context: Context): void {
    if (stopped) return
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const source = node.moduleSpecifier.text
      const clause = node.importClause
      const addImport = (
        local: string,
        imported: string,
        namespace: boolean,
        typeOnly: boolean,
      ): void => {
        if (!accept()) return
        result.imports.push({ local, imported, source, namespace, typeOnly, line: lineOf(node) })
        if (local) bind(context.scope, local, 'import')
      }
      if (!clause) addImport('', '', false, false)
      if (clause?.name) addImport(clause.name.text, 'default', false, clause.isTypeOnly)
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          addImport(clause.namedBindings.name.text, '*', true, clause.isTypeOnly)
        } else {
          for (const item of clause.namedBindings.elements) {
            addImport(
              item.name.text,
              (item.propertyName ?? item.name).text,
              false,
              clause.isTypeOnly || item.isTypeOnly,
            )
          }
        }
      }
      return
    }
    if (ts.isExportDeclaration(node)) {
      const source =
        node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : ''
      const addExport = (imported: string, exported: string, typeOnly: boolean): void => {
        if (accept())
          result.reExports.push({ source, imported, exported, typeOnly, line: lineOf(node) })
      }
      if (!node.exportClause) addExport('*', '*', node.isTypeOnly)
      else if (ts.isNamespaceExport(node.exportClause))
        addExport('*', node.exportClause.name.text, node.isTypeOnly)
      else {
        for (const item of node.exportClause.elements) {
          addExport(
            (item.propertyName ?? item.name).text,
            item.name.text,
            node.isTypeOnly || item.isTypeOnly,
          )
        }
      }
      return
    }
    if (ts.isExportAssignment(node)) {
      const expression = node.expression
      if (!node.isExportEquals) {
        if (ts.isIdentifier(expression)) {
          if (accept())
            result.reExports.push({
              source: '',
              imported: expression.text,
              exported: 'default',
              line: lineOf(node),
            })
        } else if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
          const item = functionNode(expression, context, 'default')
          item.exported = true
          item.defaultExport = true
        } else if (ts.isClassExpression(expression)) {
          const item = classNode(expression, context, 'default')
          item.exported = true
          item.defaultExport = true
        } else visit(expression, context)
      } else {
        result.diagnostics.push({
          line: lineOf(node),
          message: 'CommonJS export assignment is not statically linked.',
        })
        visit(expression, context)
      }
      return
    }
    if (ts.isFunctionDeclaration(node)) {
      const item = functionNode(node, context, node.name?.text ?? 'default')
      if (node.name) bind(context.scope, node.name.text, 'symbol', item.id)
      return
    }
    if (ts.isClassDeclaration(node)) {
      const item = classNode(node, context)
      if (node.name) bind(context.scope, node.name.text, 'symbol', item.id)
      return
    }
    if (ts.isVariableDeclaration(node)) {
      const list = ts.isVariableDeclarationList(node.parent) ? node.parent : undefined
      const destination =
        list && !(list.flags & ts.NodeFlags.BlockScoped)
          ? variableScope(context.scope)
          : context.scope
      const names = bindingNames(node.name)
      const initializer = node.initializer
      const exported = list?.parent && hasModifier(list.parent, ts.SyntaxKind.ExportKeyword)
      if (
        ts.isIdentifier(node.name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        const item = functionNode(initializer, context, node.name.text)
        item.startLine = lineOf(node)
        item.exported = !!exported
        bind(destination, node.name.text, 'symbol', item.id)
      } else if (ts.isIdentifier(node.name) && initializer && ts.isClassExpression(initializer)) {
        const item = classNode(initializer, context, node.name.text)
        item.exported = !!exported
        bind(destination, node.name.text, 'symbol', item.id)
      } else {
        for (const name of names) {
          const item = symbol(node, name, 'variable', context)
          item.exported = !!exported
          bind(destination, name, 'variable', item.id)
        }
        if (initializer) visit(initializer, context)
      }
      return
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const item = symbol(
        node,
        node.name.text,
        ts.isInterfaceDeclaration(node) ? 'interface' : 'type',
        context,
      )
      bind(context.scope, node.name.text, 'symbol', item.id)
      return
    }
    if (ts.isEnumDeclaration(node)) {
      const item = symbol(node, node.name.text, 'variable', context)
      bind(context.scope, node.name.text, 'variable', item.id)
      for (const member of node.members) if (member.initializer) visit(member.initializer, context)
      return
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      functionNode(node, context)
      return
    }
    if (ts.isClassExpression(node)) {
      classNode(node, context)
      return
    }
    if (ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
      functionNode(node, context, declarationName(node.name) ?? '<computed>')
      return
    }
    if (ts.isBlock(node) || ts.isCaseBlock(node)) {
      const inner = { ...context, scope: scope('block', context.scope, context.owner) }
      ts.forEachChild(node, (child) => visit(child, inner))
      return
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const inner = { ...context, scope: scope('block', context.scope, context.owner) }
      if (
        (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer)
      )
        recordWrite(node.initializer, inner)
      ts.forEachChild(node, (child) => visit(child, inner))
      return
    }
    if (ts.isCatchClause(node)) {
      const inner = { ...context, scope: scope('block', context.scope, context.owner) }
      if (node.variableDeclaration) {
        for (const name of bindingNames(node.variableDeclaration.name))
          bind(inner.scope, name, 'variable')
      }
      visit(node.block, inner)
      return
    }
    if (ts.isModuleDeclaration(node)) {
      if (node.body)
        visit(node.body, { ...context, scope: scope('block', context.scope, context.owner) })
      result.diagnostics.push({
        line: lineOf(node),
        message: 'TypeScript namespace exports are not statically linked.',
      })
      return
    }
    if (ts.isWithStatement(node)) {
      visit(node.expression, context)
      visit(node.statement, { ...context, dynamic: true })
      return
    }
    if (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isTaggedTemplateExpression(node)
    ) {
      if (accept()) {
        result.calls.push({
          from: context.owner.id,
          callee: context.dynamic
            ? '<dynamic>'
            : (expressionName(ts.isTaggedTemplateExpression(node) ? node.tag : node.expression) ??
              '<dynamic>'),
          scopeId: context.scope.id,
          line: lineOf(node),
          construct: ts.isNewExpression(node),
        })
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      recordWrite(node.left, context)
      if (ts.isObjectLiteralExpression(node.left) || ts.isArrayLiteralExpression(node.left)) {
        // Assignment patterns can replace bindings even though they are not declarations.
        const identifiers = (target: ts.Node): void => {
          if (ts.isIdentifier(target)) writes.push({ name: target.text, scopeId: context.scope.id })
          else if (ts.isPropertyAssignment(target)) identifiers(target.initializer)
          else if (ts.isShorthandPropertyAssignment(target)) identifiers(target.name)
          else ts.forEachChild(target, identifiers)
        }
        identifiers(node.left)
      }
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      recordWrite(node.operand, context)
    }
    if (ts.isDeleteExpression(node)) recordWrite(node.expression, context)
    ts.forEachChild(node, (child) => visit(child, context))
  }
  try {
    visit(file, root)
  } catch {
    result.diagnostics.push({
      line: 1,
      message: 'Structural parser could not finish this source; file is partial.',
    })
  }
  const bindings = new Map<string, CodeBinding[]>()
  for (const binding of result.bindings) {
    const key = `${binding.scopeId}\0${binding.name}`
    const group = bindings.get(key) ?? []
    group.push(binding)
    bindings.set(key, group)
  }
  for (const write of writes) {
    if (write.name.includes('.')) {
      // A dotted name cannot be a lexical binding. It records a property mutation
      // for the linker, which can resolve imported/class receivers across files.
      if (accept()) result.bindings.push({ ...write, kind: 'variable' })
      continue
    }
    let current: string | undefined = write.scopeId
    while (current) {
      const found = bindings.get(`${current}\0${write.name}`)
      if (found) {
        for (const binding of found) {
          binding.kind = 'variable'
          delete binding.target
        }
        break
      }
      current = scopes.get(current)?.parentId
    }
  }
  return result
}
