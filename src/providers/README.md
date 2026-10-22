# Model bağlantıları

ChatGPT tarafında ajan motoru Codex app-server olacak; yerel Ollama ayrı bir sağlayıcı adaptörü olarak bağlanacak. MWIDE proje, sohbet ve MCP/Skill seçimlerinin sahibi olarak kalır. ChatGPT plan kullanımı, OpenAI API anahtarı ve yerel sunucu erişimi ayrı kimlik ve bütçe yollarıdır.

Codex app-server yerel bir yan süreç olarak yönetilecek; protokol sürümü, akış, iptal ve devam etme bu adaptörün sorumluluğunda olacak. Henüz app-server bağlantısı, ağ isteği, oturum açma veya model çalıştırma uygulanmamıştır. Kimlik bilgileri renderer'a aktarılmamalı; ağ erişimi ve iptal arayüzleri gerçek entegrasyon sırasında tanımlanmalıdır.
