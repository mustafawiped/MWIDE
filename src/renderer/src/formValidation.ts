export function focusInvalidField(form: HTMLFormElement, name: string): void {
  const field = form.elements.namedItem(name)
  if (field instanceof HTMLElement) field.focus()
}
