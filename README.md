# جاهز — نظام متابعة الشحنات (استضافة ذاتية)

هذه نسخة الاستضافة الذاتية من نظام متابعة العمليات الذي كان يعمل على
`congstars.vercel.app`. الكود مأخوذ من `chrollohxh/shipments-system` كما هو،
والرابط الجديد: **https://jahez.swaken.net**

## ما الذي تغيّر عن Vercel

| على Vercel | هنا |
|---|---|
| ملفات ثابتة تُقدَّم من CDN | `server.js` يقدّم نفس الملفات من الحاوية |
| دوال Serverless في `api/` | نفس الملفات تعمل عبر `server.js` على نفس المسارات `/api/...` |
| توليد PDF عبر خدمة Browserless المدفوعة | Chromium داخل الحاوية (مجاني)، وBrowserless يبقى خياراً |
| قاعدة البيانات Supabase | **لم تتغير** — نفس المشروع ونفس البيانات ونفس المستخدمين |

الواجهة `index.html` كما هي، باستثناء إضافة واحدة: رمز QR القصير لحزمة العملية
(انظر قسم «رمز QR» أدناه). ملفات SQL والأدلة الأصلية نُقلت إلى مجلد `supabase/`
للرجوع إليها فقط، ولا تُقدَّم للمتصفح.

## المتطلبات على السيرفر

- Docker مع Docker Compose (موجودان على bahar-ugreen).
- منفذ حر: **7790** (المنصة تستخدم 7780).
- وصول للإنترنت من الحاوية إلى Supabase وGoogle Fonts.

## النشر

### الطريقة الأولى — من GitHub Actions (المفضّلة)

الملف `.github/workflows/deploy.yml` ينشر تلقائياً **عند كل دفع إلى main**، ويمكن
تشغيله يدوياً من Actions ← **Deploy JAHEZ** ← Run workflow (مع اختيار ref).

يعمل على runner ذاتي مثبت على السيرفر ومسجَّل على هذا المستودع بالوسم `jahez`.
تسجيله مرة واحدة (بحساب gojawad على bahar-ugreen):

1. GitHub ← هذا المستودع ← Settings ← Actions ← Runners ← **New self-hosted runner**
   ← Linux / x64. تظهر أوامر التنزيل مع توكن صالح لساعة.
2. نفّذ الأوامر كما هي، لكن في مجلد مستقل حتى لا يتداخل مع أي runner آخر على
   السيرفر، مثلاً `~/actions-runner-jahez`.
3. عند `./config.sh` اكتب في سؤال الوسوم (labels): `jahez`. باقي الأسئلة بالافتراضي.
4. ثبّته كخدمة تعمل دائماً:

   ```bash
   sudo ./svc.sh install gojawad
   sudo ./svc.sh start
   ```

5. تأكد أن الـ runner ظهر بحالة Idle في صفحة Runners، ثم شغّل Deploy JAHEZ.

الـ Workflow يستنسخ المستودع إلى `/home/gojawad/projects/jahez`، يبني الصورة،
يشغّل الحاوية، ويتحقق من `/healthz`. إن فشل الفحص يعيد النسخة السابقة تلقائياً.
ملف `.env` يبقى في ذلك المجلد ولا يمسّه النشر.

### الطريقة الثانية — يدوياً على السيرفر

```bash
git clone https://github.com/gojawad/jahez.git /home/gojawad/projects/jahez
cd /home/gojawad/projects/jahez
cp .env.example .env      # ثم عبّئ المفاتيح (انظر أدناه)
BUILD_SHA=$(git rev-parse HEAD) DEPLOYED_AT=$(date -u +%FT%TZ) docker compose up -d --build
curl -s http://127.0.0.1:7790/healthz
```

للتحديث لاحقاً: `git pull` ثم نفس أمر `docker compose up -d --build`.

## ملف `.env` على السيرفر

انسخ `.env.example` إلى `.env` في مجلد المشروع على السيرفر. الموقع يعمل بدون أي
متغير، وكل متغير يفعّل ميزة واحدة:

| المتغير | يفعّل | من أين |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | فتح حزمة العملية من رمز QR (`/s/<token>`) والصفحة العامة القديمة (`/api/public-shipment`) | Supabase ← Project Settings ← API ← `service_role` |
| `BROWSERLESS_TOKEN` | اختياري — استخدام Browserless بدل Chromium المحلي | Vercel ← Project ← Settings ← Environment Variables |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_TENANT_ID` | ربط Word Online (`/api/microsoft`) | Azure App Registration |

القيم نفسها موجودة حالياً في Vercel ← المشروع ← Settings ← Environment Variables.

## ربط الرابط jahez.swaken.net عبر Cloudflare

الحاوية تستمع على `http://127.0.0.1:7790` على السيرفر. اربطها بنفس الطريقة التي
يعمل بها `bsgt.swaken.net`:

**إن كان bsgt يعمل عبر Cloudflare Tunnel** (سجل DNS من نوع CNAME ينتهي بـ
`cfargotunnel.com`):

1. Cloudflare ← Zero Trust ← Networks ← Tunnels & Mesh ← النفق `bsgt-erp`.
2. تبويب **Published application routes** ← Add a published application route:
   - Subdomain: `jahez` — Domain: `swaken.net`
   - Type: `HTTP` — URL: نفس عنوان السيرفر المستخدم في صف bsgt مع المنفذ 7790،
     أي `192.168.70.179:7790` (cloudflared لا يعمل على سيرفر Docker نفسه، لذلك
     `localhost` لا يصلح هنا).
3. احفظ. سجل DNS يُنشأ تلقائياً والشهادة من Cloudflare.

تم تنفيذ هذا فعلياً في 2026-09-06.

**إن كان bsgt يعمل بسجل A مباشر مع nginx أو Caddy على السيرفر**:

1. Cloudflare ← DNS ← Add record: `A` — Name `jahez` — نفس IP السيرفر — Proxied.
2. أضف موقعاً في الوكيل العكسي يمرّر `jahez.swaken.net` إلى `127.0.0.1:7790`.
   مثال nginx:

   ```nginx
   server {
     listen 80;
     server_name jahez.swaken.net;
     client_max_body_size 20m;
     location / {
       proxy_pass http://127.0.0.1:7790;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 120s;
     }
   }
   ```

## رمز QR: حزمة العملية الكاملة من رابط قصير

كل فاتورة تحمل رمز QR برابط قصير بشكل `https://jahez.swaken.net/s/<رمز-سري>`.
من يمسحه يفتح ملف PDF واحداً يضم العملية بكل مستنداتها ومرفقاتها.

كيف يعمل:

1. عند الضغط على **تجميع الحزمة الكاملة PDF** في شاشة الشحنة، يولّد البرنامج رمزاً
   سرياً للعملية إن لم يكن موجوداً (`qrToken` داخل بيانات الشحنة)، ويبني الحزمة،
   ثم يرفعها إلى bucket `shipment-files` تحت `qr-package/<shipment_id>/` ويسجّل
   مسارها (`qrPackagePath`).
2. الفواتير المطبوعة بعد ذلك تحمل الرابط القصير في رمز QR.
3. الخادم عند `/s/<token>` يبحث عن الشحنة بالرمز بمفتاح `service_role`، ويجلب
   ملف الحزمة من التخزين ويعرضه PDF مباشرة. لا تسجيل دخول، لكن الرمز غير قابل
   للتخمين (144 بت عشوائية).

ملاحظات:

- يلزم `SUPABASE_SERVICE_ROLE_KEY` في `.env` على الخادم، وإلا يعرض الرابط رسالة
  «غير جاهز بعد».
- الرابط يفتح **آخر حزمة جُمِّعت**. بعد أي تعديل على العملية أعد التجميع ليتحدث الملف.
- لا حاجة لأي SQL جديد: الحقول تُحفظ في عمود `data` المرن، والملفات في bucket موجود.
- شحنة لم تُجمَّع حزمتها بعد يعرض رابطها صفحة تشرح ذلك، ورمزها القديم (إن طُبع
  قبل التحديث) يبقى يعمل بالطريقة السابقة.

## بعد أن يعمل الرابط

1. **Supabase** ← Authentication ← URL Configuration: أضف
   `https://jahez.swaken.net` إلى Site URL / Redirect URLs حتى تعمل روابط
   استعادة كلمة المرور.
2. **Azure** (إن كنت تستخدم ربط Word): أضف
   `https://jahez.swaken.net/api/microsoft?action=callback` في Redirect URIs.
3. **رموز QR القديمة** المطبوعة قبل الانتقال تشير إلى `congstars.vercel.app`
   ولن تعمل بعد إيقافه. الفواتير الجديدة تحمل الرابط القصير على jahez.swaken.net.
4. أوقف مشروع Vercel عندما تطمئن.

## الفحص والتطوير

```bash
npm install
CHROMIUM_PATH=/path/to/chromium npm test   # 10 فحوصات دخانية تشمل توليد PDF فعلي
npm start                                  # http://localhost:3000
```

## إرجاع نسخة سابقة

```bash
cd /home/gojawad/projects/jahez
docker images jahez            # كل نشر يترك صورة موسومة بالـ SHA
BUILD_SHA=<sha-سابق> docker compose up -d --no-build
```
