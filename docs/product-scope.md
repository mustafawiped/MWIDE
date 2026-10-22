# Ürün kapsamı

MWIDE — **Easy MCP and Skill Management**

MWIDE'nin temel birimi projedir. Kullanıcı bir projenin altında promptlarını, sohbetlerini, seçtiği model bağlantılarını ve proje için etkinleştirdiği MCP/Skill araçlarını yönetir. Proje yalnız bir kod deposu olmak zorunda değildir; araştırma, içerik veya başka bir çalışma konusu da olabilir.

## Bu başlangıç sürümü

İlk sürümün amacı, geliştirilebilir ve kontrol edilebilir bir masaüstü uygulama temeli oluşturmaktır. Model bağlantısı, çalışan sohbet, veritabanı, katalogdan kurulum veya araç çalıştırma henüz yoktur. Arayüzde gösterilen planlanan yetenekler, tamamlanmış entegrasyon anlamına gelmez.

## İlk geliştirilecek akış

1. Kullanıcı bir proje oluşturur ve konusunu/açıklamasını belirler.
2. Kullanıcı ChatGPT veya yerel model bağlantısını seçer.
3. Prompt ve sohbetler ilgili projenin altında saklanır.
4. MWIDE, proje bağlamına uygun MCP sunucuları ve Skill paketleri önerir.
5. Kullanıcı öneriyi inceler, seçer ve gereken erişimlere izin verir.

Öneri üretmek, kurulum veya çalıştırma izni değildir. Bir projenin araçları ve yetkileri başka bir projeye kendiliğinden taşınmaz. Araç kurulumu ve çalıştırması sonraki geliştirmelerde ayrı kullanıcı eylemleri olarak tasarlanmalıdır.

## Sağlayıcı sırası

**Ollama:** İlk yerel model hedefidir. Model seçimi, akış halinde yanıt, isteği durdurma ve bağlantı hataları önce bu sağlayıcıyla doğrulanır. [Ollama API](https://docs.ollama.com/api/introduction)

**ChatGPT / Codex app-server:** ChatGPT tarafında motor olarak Codex app-server seçilmiştir. MWIDE, yerel yan süreçteki motora kendi adaptörü üzerinden bağlanacak; proje, sohbet ve katalog düzeninin sahibi olmaya devam edecektir. Şu anda gerçek app-server entegrasyonu ve Codex bağımlılığı yoktur. [Codex app-server](https://learn.chatgpt.com/docs/app-server)

**ChatGPT hesabıyla giriş:** Motor seçiminden ayrı olarak, uygun açık kaynak ve yerel dağıtım için Sign in with ChatGPT plan kullanımı hedeflenir. Hesap girişi, kullanıcının ChatGPT'deki eski sohbetlerine erişim sağlamaz. Ücretli veya barındırılan dağıtım için izin kapsamı ayrıca doğrulanmalıdır. [OpenAI kapsamı](https://developers.openai.com/siwc/token-sharing-open-source)

**OpenAI API anahtarı:** ChatGPT aboneliğinden ayrı bir erişim ve ücretlendirme yoludur. Eklenirse kullanıcı bunu açıkça seçmeli; abonelik sınırına ulaşıldığında sessizce bu yola geçilmemelidir.

**Sonraki bağlantılar:** LM Studio'nun OpenAI uyumlu sunucusu ve daha sonra Claude. [LM Studio API](https://lmstudio.ai/docs/developer/openai-compat)

## İlk kapsamın sınırları

Tam IDE, kapsamlı kod editörü, VS Code eklenti uyumluluğu, otomatik kod deposu mimarisi üretimi, otonom ajan çalıştırma ve bulut eşitleme bu başlangıcın hedefi değildir. Sohbet devri ve daha gelişmiş proje hafızası, temel sohbet ve kalıcılık doğrulandıktan sonra ele alınır.

MCP/Skill yönetiminde ilk hedef, anlaşılır bir katalog, proje bazında seçim ve izinlerin görünürlüğüdür. Kullanıcının onayı olmadan paket kurulmaz, komut yürütülmez veya MCP sunucusu başlatılmaz.
