# MWIDE

**Easy MCP and Skill Management**

MWIDE, projelere göre düzenlenen bir prompt ve sohbet çalışma ortamıdır. Amacı; proje bağlamını korumak, MCP sunucularını ve Skill paketlerini yönetmek ve projenin konusuna uygun öneriler sunmaktır.

Bu depo ilk GitHub başlangıç sürümüdür. Electron ve React uygulama iskeletini, temel modül sınırlarını ve geliştirme araçlarını içerir. Sohbet gönderme, model bağlantısı, kalıcı geçmiş, MCP veya Skill kurulumu henüz uygulanmamıştır.

## Başlangıç

Gereksinimler:

- Node.js 24.11 veya üzeri
- pnpm 11.25 veya üzeri

Bağımlılıkları kurun ve geliştirme uygulamasını başlatın:

```sh
pnpm install
pnpm dev
```

Kontrolleri ve üretim derlemesini çalıştırın:

```sh
pnpm check
pnpm build
```

Bu aşamada `.env` dosyası veya sağlayıcı anahtarı gerekmez. Anahtarları, oturum belirteçlerini ve kişisel proje verilerini depoya eklemeyin.

## İlk ürün kapsamı

- Projeye bağlı prompt ve sohbet akışları
- ChatGPT ve yerel LLM bağlantıları
- Projeye eklenebilen MCP sunucuları ve Skill paketleri
- Projenin konusu ve kullanıcının amacı üzerinden öneriler

Önerilen bir MCP sunucusu veya Skill, kullanıcının seçimi ve gerekli izni olmadan kurulmaz ya da çalıştırılmaz. Tam kod editörü ve IDE eklenti ekosistemi ilk kapsamda değildir.

ChatGPT tarafında seçilen motor **Codex app-server**'dır; MWIDE'nin yönettiği yerel bir yan süreç olarak bağlanması planlanır. Projeler, sohbetler ve MCP/Skill kataloğu MWIDE'ye ait kalır. Bu başlangıç sürümünde gerçek app-server entegrasyonu veya Codex bağımlılığı yoktur. [Codex app-server](https://learn.chatgpt.com/docs/app-server)

Motor seçimi ile kimlik doğrulama ayrı kararlardır. ChatGPT planını kullanmak için hedef, uygun açık kaynak ve yerel kullanım koşullarında **Sign in with ChatGPT** entegrasyonudur. OpenAI API anahtarı ise ayrı bir erişim ve ayrı API faturalandırmasıdır; ChatGPT aboneliğiyle aynı bütçe değildir. Bu giriş yolları henüz bağlı değildir. [Resmî entegrasyon kapsamı](https://developers.openai.com/siwc/token-sharing-open-source)

Yerel modellerde ilk hedef Ollama'dır. LM Studio'nun OpenAI uyumlu yerel sunucusu sonraki aşamada değerlendirilecektir. Claude entegrasyonu ilk aşamanın dışındadır.

## Geliştirme sırası

1. Uygulama kabuğu, modül sözleşmeleri ve geliştirme kontrolleri
2. Proje kaydı ve SQLite ile yerel kalıcılık
3. Ollama üzerinden ilk gerçek sohbet akışı
4. Codex app-server adaptörü, uygun ChatGPT girişi ve sağlayıcı/bütçe görünürlüğü
5. MCP ve Skill kataloğu, kullanıcı seçimi ve izinli yönetim
6. Proje konusuna göre öneriler ve sohbet devamlılığı

Tek paketli yapı Electron, React, TypeScript, electron-vite ve pnpm kullanır. SQLite bu başlangıç sürümüne bağımlılık olarak eklenmemiştir.

- [Ürün kapsamı](docs/product-scope.md)
- [Mimari yaklaşım](docs/architecture.md)
