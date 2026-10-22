# Mimari yaklaşım

MWIDE, tek paketli bir Electron + React + TypeScript uygulamasıdır. electron-vite geliştirme ve derlemeyi, pnpm paket yönetimini sağlar. İlk temel, proje odaklı sohbet ve MCP/Skill yönetimine genişleyebilecek modül sınırlarını kurar; çalışan model veya araç entegrasyonu içermez.

## Modül sınırları

| Konum           | Sorumluluk                                                                    |
| --------------- | ----------------------------------------------------------------------------- |
| `src/main`      | Electron yaşam döngüsü, pencere ve ayrıcalıklı masaüstü işlemleri             |
| `src/preload`   | Arayüze açılan dar ve tipli masaüstü köprüsü                                  |
| `src/renderer`  | React arayüzü, proje ve sohbet görünümleri                                    |
| `src/shared`    | Süreçler arasında paylaşılan veri ve iletişim sözleşmeleri                    |
| `src/core`      | Proje, sohbet ve kullanıcı seçimlerine ait sağlayıcıdan bağımsız iş kuralları |
| `src/providers` | Codex app-server, bağımsız Ollama ve sonraki bağlantıların adaptörleri        |
| `src/catalog`   | MCP/Skill tanımları, proje eşleştirmesi ve öneri modeli                       |

Bu klasörler ayrı servis veya ayrı paket değildir. Bir modülün varlığı, ilgili ürün işlevinin tamamlandığı anlamına gelmez.

## Süreçler ve veri akışı

Arayüz, dosya sistemi veya kimlik bilgilerine doğrudan erişmemelidir. Gerekli masaüstü işlemleri preload üzerinden sınırlı isteklerle ana sürece iletilir. Çekirdek, sağlayıcıya özgü olayları doğrudan kullanıcı veri modeline dönüştürmek yerine ortak sözleşmeler kullanır.

Model bağlantıları eklenirken kullanıcı mesajı, yanıt akışı, iptal, hata ve kullanım kaynağı ayrı ele alınmalıdır. Codex thread kimliği ile MWIDE'nin yerel proje/sohbet kimliği birbirine bağlanabilir; aynı kimlik olarak kullanılmamalıdır. Projeler, sohbet geçmişi ve MCP/Skill kataloğunun sahibi MWIDE'dir.

SQLite sonraki kilometre taşında yerel proje ve sohbet kalıcılığı için eklenir. Bu başlangıç sürümünde veritabanı bağımlılığı veya kalıcılık garantisi yoktur.

## Sağlayıcı yaklaşımı

ChatGPT tarafında motor kararı Codex app-server'dır. MWIDE, motoru yerel bir yan süreç olarak yönetecek ve adaptörü üzerinden protokolle iletişim kuracaktır. Entegrasyonda `initialize`, `thread/start` ve `turn/start` akışı; yanıt olayları, iptal ve oturuma devam etme ele alınacaktır. Bu başlangıç sürümünde gerçek app-server bağlantısı, yan süreç yönetimi veya Codex bağımlılığı yoktur. Protokol/sürüm sabitleme ve token yenileme, entegrasyon aşamasının işleridir. [Codex app-server](https://learn.chatgpt.com/docs/app-server)

Ollama, Codex motorundan bağımsız ilk yerel sağlayıcıdır. Yerel sunucu adresi ve model seçimi açık olmalı; bağlantı kurulamadığında kullanıcı anlaşılır bir hata görmelidir. LM Studio için OpenAI uyumlu protokol sonraki bir adaptör olarak ele alınır; iki sağlayıcının bütün yeteneklerinin aynı olduğu varsayılmaz.

Codex motoru seçimi, ChatGPT hesabını veya abonelik limitlerini kullanma yetkisini kendiliğinden sağlamaz. Kimlik ve abonelik yolu için hedef, uygun dağıtım koşullarında resmî Sign in with ChatGPT akışıdır. Sistem tarayıcısı, kullanıcı izni ve güvenli yerel oturum saklama tasarlanmalıdır. Plan kullanımı yolu ile API anahtarlı OpenAI erişimi ayrı yapılandırmalar olmalıdır. Aktif hesap ve ödeme kaynağı görünür olmalı; API anahtarına otomatik ücretli geçiş yapılmamalıdır. [OpenAI giriş kapsamı](https://developers.openai.com/siwc/token-sharing-open-source), [SIWC ile app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

ChatGPT plan kullanımında desteklenen API özellikleri ve bağlam yönetimi sınırlıdır. Uygulama geçmişin sahibi olmalı; desteklenmeyen sunucu özelliklerine bağlı kalmamalıdır. [Önizleme sınırları](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## MCP ve Skill yönetimi

Katalog tanımı, öneri, projeye ekleme, kurulum ve çalıştırma ayrı adımlardır. Projenin açıklamasından üretilen bir öneri, komut yürütme yetkisi vermez. Bir araç için kaynak, sürüm, gerekli erişimler ve proje kapsamı gösterilmelidir.

MCP sunucuları sonraki aşamada ayrı süreçler olarak yönetilmelidir. Başlatma/durdurma, hata, zaman aşımı ve izin iptali ürün akışının parçasıdır. Skill içeriği de kullanıcı yetkilerini genişletemez. Bu başlangıç sürümü bu işlemleri yürütmez.

## İlk uygulama sırası

Önce proje ve sohbet veri modeli ile yerel kalıcılık; ardından Ollama sohbet akışı; sonra Codex app-server adaptörü ve uygun ChatGPT bağlantısı; ardından katalog ve izinli MCP/Skill yönetimi geliştirilir. Proje konusu üzerinden öneriler, bu temel akışlar doğrulandıktan sonra eklenir. Kimlik bilgileri veya kişisel proje verileri kaynak deposunda tutulmaz.
