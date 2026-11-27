# تحويل IPTV For All لأندرويد (Android TV / موبايل / تابلت)

## الخلاصة
**ممكن، ومن أسهل الحاجات اللي ممكن تتعمل في المشروع ده**، لأن التطبيق أصلاً صفحة ويب عادية (HTML/JS/CSS من غير framework ولا build). أندرويد فيه عنصر **WebView** (مبني على Chromium) تقدر تحط فيه نفس الصفحة، فمعظم الكود (قراءة القوائم، Xtream، الدليل، الكاش، القفل العائلي، الشاشات) بيتنقل كما هو. اللي بيتغيّر: **غلاف أندرويد صغير** + شوية تعديلات في الأزرار والخروج، واختيارياً **مشغّل أصلي (ExoPlayer)** لجودة تشغيل أحسن.

> **حالة التجربة:** ده تحليل وخطة، **مش تطبيق أندرويد جاهز**. في البيئة اللي اشتغلت فيها Java و Gradle موجودين لكن **مفيش Android SDK**، فماقدرتش أبني APK ولا أجرّبه. الأكواد الصغيرة المكتوبة تحت هي **رسومات توضيحية (sketch) ماتجمّعتش**. تحويل حقيقي محتاج Android Studio أو SDK.

---

## 1. إيه اللي بيتنقل كما هو وإيه اللي بيتغيّر

| الجزء | الوضع على أندرويد |
|---|---|
| الشاشات والواجهة (`screens/*`, `widgets.js`, CSS) | بيشتغل كما هو في WebView. الصفحة ثابتة 1920×1080 وبتتصغّر تلقائياً (`fit()` في `app.js`) |
| M3U / Xtream / XMLTV / القفل العائلي / Continue / اللغات | منطق JS نقي، من غير تعديل |
| حفظ البيانات (`localStorage`, IndexedDB) | بيشتغل لو فعّلنا `domStorageEnabled` |
| التشغيل: HLS عبر hls.js، الكاش الذكي (MediaSource + mp4box) | بيشتغل في WebView الحديث (Chromium). الكود أصلاً متكتب يشتغل على Chromium 53 فهو أقدم من أي WebView حالي |
| أزرار الريموت (`keys.js`) | محتاج تعديل بسيط: زر Back وألوان الريموت (تحت) |
| الخروج من التطبيق (`router.js`) | بيستدعي `PalmSystem.platformBack()` الخاص بـ LG، وده مش موجود على أندرويد، فلازم جسر (bridge) للخروج |
| `appinfo.json` | خاص بـ webOS، بيتستبدل بـ `AndroidManifest.xml` |
| فتح التطبيق على الموبايل (لمس) | القوائم والشريط بيستجيبوا للّمس لأنهم click handlers، لكن التصميم أصلاً للتلفزيون (انظر القسم 4) |

---

## 2. الاختيارات المتاحة

| # | الطريقة | الجهد | المميزات | العيوب |
|---|---|---|---|---|
| **A** | **غلاف WebView بسيط** (Kotlin، أو Capacitor) بنفس كود الويب | صغير | أسرع طريق، 99% من الكود زي ما هو، APK خفيف | التشغيل بمشغّل الـ WebView: كودكات (HEVC/AC3/E-AC3/DTS) ودعم MKV محدودين حسب الجهاز |
| **B** | **A + مشغّل أصلي ExoPlayer (Media3)** بجسر JavaScript | متوسط | أحسن تشغيل: MKV وكل الكودكات تقريباً وAC3 وترجمات مدمجة وتحكم كامل في الـ buffer. ممكن يشيل الحاجة للكاش الذكي المكتوب بـ JS | محتاج كود Kotlin إضافي وتطابق مع واجهة `Engine` |
| **C** | **PWA / TWA** (موقع HTTPS) | صغير | لا تثبيت يدوي | **مش مناسب:** معظم مزوّدي IPTV بـ `http://` والصفحة HTTPS بتمنع المحتوى المختلط (mixed content)، ومعاها قيود CORS |
| **D** | **إعادة كتابة أصلية** (Kotlin + Compose for TV) | كبير جداً | أفضل أداء وتجربة أندرويد أصلية | شغل من الصفر تقريباً، منطق الويب بيتعاد كتابته |

**التوصية:** ابدأ بـ **A** (نتيجة في أيام قليلة)، وبعد ما تشوف المشاكل الفعلية على جهازك، أضف **B** لو التشغيل (الكودكات/MKV) هو العائق. D مش مبرر إلا لو هتبيع/توزّع على نطاق واسع بتجربة أصلية.

---

## 3. المشاكل المتوقعة وحلولها

### 3.1 CORS (الأهم)
على webOS الصفحة بتتحمّل من ملف محلي. على أندرويد لو استخدمت Capacitor فالصفحة بتتحمّل من `https://localhost` فطلبات XHR لسيرفرات IPTV (اللي غالباً مابتبعتش ترويسات CORS) هتتحجب.
- **حل 1 (الأبسط):** غلاف Kotlin بيحمّل `file:///android_asset/app/index.html` ويفعّل `allowUniversalAccessFromFileURLs` فالصفحة تكلّم أي سيرفر.
- **حل 2:** جسر HTTP أصلي (طلبات الشبكة من Kotlin، مش من المتصفح). ده بيحل CORS والـ User-Agent المخصص كمان (المتصفح مايقدرش يبعت `|User-Agent=` اللي في روابط M3U).
- التطبيق فيه أصلاً إعداد **CORS proxy** كحل احتياطي.

### 3.2 HTTP غير المشفّر (cleartext)
أندرويد 9+ بيمنع `http://` افتراضياً. لازم `android:usesCleartextTraffic="true"` في الـ Manifest (أو `network_security_config`)، ومعاه `mixedContentMode = ALWAYS_ALLOW` في الـ WebView.

### 3.3 زر الرجوع وأزرار الألوان
- زر Back في أندرويد مابيوصلش للصفحة كـ keydown. بتعترضه في `Activity` (`dispatchKeyEvent` أو `OnBackPressedCallback`) وتحقن لـ JS الكود `461` (اللي `keys.js` فاهمه كـ Back).
- ريموتات Android TV غالباً **مفيهاش ألوان**. أندرويد عنده `KEYCODE_PROG_RED/GREEN/YELLOW/BLUE` (183–186) للي فيها، وبتتحوّل لـ 403–406. للباقي لازم بدائل: أزرار على الشاشة أو Menu/Info. ده أهم تعديل في الواجهة لأن الأحمر/الأخضر/الأصفر/الأزرق ليهم وظايف كتير (مفضلة، صوت وترجمة، إعدادات، تحديث).
- الأسهم وOK والأرقام وأزرار الميديا بتوصل للصفحة كأحداث `keydown` عادية والـ WebView بيحوّلها لأكواد الويب (مثلاً تشغيل/إيقاف = `179` وهو أصلاً موجود في `keys.js`)، فغالباً بتشتغل من غير شغل. تأكد منها على الجهاز لأن ريموتات الشركات مختلفة.
- الأفضل تضيف دالة صغيرة `IPTV.Keys.press(code)` في `keys.js` يناديها الغلاف الأصلي بدل محاكاة `KeyboardEvent`.

### 3.4 الخروج من التطبيق
`Router.exit()` لازم يلاقي بديل: `window.AndroidBridge.exit()` (دالة `@JavascriptInterface` بتنادي `finish()`).

### 3.5 الكودكات والتشغيل
مشغّل الـ WebView أضعف من ExoPlayer: بيدعم H.264/VP9 وAAC عادةً، وHEVC/AC3 حسب الجهاز. لو مشكلتك في MKV أو الصوت المتعدد أو الترجمة المدمجة، ده بالظبط سبب اختيار **B** (ExoPlayer). فكرته: يتحط `SurfaceView` للفيديو وراء WebView شفاف، وبيتعمل `NativeEngine` يطبّق نفس واجهة `Engine` الحالية: `load / stop / seekTo / togglePause / tracks / setAudio / setText / bufferInfo` وأحداثها (`playing / paused / loading / ended / error / time / meta / buffer`). كده باقي الواجهة (المشغّل، الصوت والترجمة، شريط التقدم) ما يتغيّرش.

### 3.6 الأداء على أجهزة ضعيفة
قوائم القنوات الكبيرة شغّالة بتقنية "الصفحة الظاهرة بس" فخفيفة، لكن أجهزة Android TV الرخيصة (ذاكرة 1–2 جيجا) ممكن تحتاج تقليل حجم الكاش الذكي (الإعداد 64 ميجا).

### 3.7 الموبايل والتابلت
الواجهة مصمّمة للتلفزيون (أحجام كبيرة، التحكم بالأسهم). على الموبايل هتشتغل بالأفقي بعد تصغيرها، لكن **مش مريحة بدون شغل إضافي:** عمودية، سحب للتمرير، أزرار لمس بدل الألوان، لوحة مفاتيح الجهاز. لو الهدف التلفزيون بس (Android TV / Fire TV / Google TV / صناديق Android) فالتعديلات أقل بكتير.

---

## 4. ازاي تبدأ (خطة الطريقة A)

1. **مشروع أندرويد جديد** في Android Studio (Empty Activity، Kotlin). انسخ مجلد `app/` كامل (من غير `appinfo.json` والأيقونات) إلى `app/src/main/assets/app/`.
2. **`AndroidManifest.xml`** (أهم النقاط):
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <!-- التلفزيون: لا نشترط اللمس، ونعلن دعم Leanback -->
   <uses-feature android:name="android.hardware.touchscreen" android:required="false" />
   <uses-feature android:name="android.software.leanback" android:required="false" />
   <application android:usesCleartextTraffic="true" android:banner="@drawable/banner" ...>
     <activity android:name=".MainActivity" android:exported="true" android:screenOrientation="landscape">
       <intent-filter>
         <action android:name="android.intent.action.MAIN" />
         <category android:name="android.intent.category.LAUNCHER" />
         <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
       </intent-filter>
     </activity>
   </application>
   ```
   وأضف أيقونة بانر 320×180 لشاشة Android TV.
3. **`MainActivity`** (رسم توضيحي، ماتجمّعش):
   ```kotlin
   class MainActivity : Activity() {
     private lateinit var web: WebView

     override fun onCreate(b: Bundle?) {
       super.onCreate(b)
       web = WebView(this).apply {
         settings.javaScriptEnabled = true
         settings.domStorageEnabled = true                       // localStorage + IndexedDB
         settings.mediaPlaybackRequiresUserGesture = false
         settings.allowFileAccess = true
         settings.allowUniversalAccessFromFileURLs = true        // الصفحة تكلّم أي سيرفر IPTV (من غير CORS)
         settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
         webChromeClient = WebChromeClient()
         addJavascriptInterface(object { @JavascriptInterface fun exit() { runOnUiThread { finish() } } }, "AndroidBridge")
         loadUrl("file:///android_asset/app/index.html")
       }
       setContentView(web)
     }

     override fun dispatchKeyEvent(e: KeyEvent): Boolean {
       if (e.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(e)
       val code = when (e.keyCode) {
         KeyEvent.KEYCODE_BACK -> 461
         KeyEvent.KEYCODE_PROG_RED -> 403;  KeyEvent.KEYCODE_PROG_GREEN -> 404
         KeyEvent.KEYCODE_PROG_YELLOW -> 405; KeyEvent.KEYCODE_PROG_BLUE -> 406
         KeyEvent.KEYCODE_MENU -> 405        // بديل مقترح للأصفر (الإعدادات)
         else -> return super.dispatchKeyEvent(e)
       }
       web.evaluateJavascript("IPTV.Keys.press($code)", null)
       return true
     }
   }
   ```
4. **تعديلات صغيرة في كود الويب:**
   - `keys.js`: دالة `press(code)` عامة تستدعي نفس الـ handler.
   - `router.js`: في `exit()` جرّب `window.AndroidBridge && AndroidBridge.exit()`.
   - بدائل الألوان على الشاشة (أو توزيعها على Menu/Info/Subtitle).
5. **ابنِ وجرّب** على Android TV (جهاز حقيقي أو Emulator "Android TV") وبعدها على موبايل. جرّب بالترتيب: فتح قائمة، تشغيل قناة HLS، فيلم MP4 (الكاش)، فيلم MKV، تغيير الصوت والترجمة، الريموت (Back والألوان).
6. **التوزيع:** ملف APK للتثبيت المباشر (Sideload) أبسط شي. نشره على Google Play ممكن لكن تطبيقات IPTV بتتراجع بتدقيق، وبيحتاج تأكيد إن التطبيق **مابيجيبش محتوى** (وده الوضع الحالي فعلاً).

### لو اخترت Capacitor بدل غلاف Kotlin
`npm i @capacitor/core @capacitor/cli @capacitor/android` ثم `npx cap init` و`webDir: "app"` ثم `npx cap add android`. انتبه لمشكلة CORS (3.1): الصفحة بتتحمّل من `https://localhost` فحتحتاج إما طلبات HTTP أصلية (CapacitorHttp) أو تعديل إعدادات الـ WebView. وللتحكم الكامل في الـ WebView والجسر، غلاف Kotlin المباشر أبسط وأوضح.

---

## 5. التقدير التقريبي (هنا تقدير مش وعد)
- **A (غلاف WebView على Android TV):** أيام قليلة لو الأجهزة متاحة للتجربة.
- **B (ExoPlayer + جسر):** بعد A بأسبوع أو أكتر حسب عمق التكامل (الأحداث، المسارات، الكاش، الأخطاء).
- **تنقية الموبايل:** حسب مدى التغيير المطلوب في التصميم.

## 6. الخطوة الجاية المقترحة
أقدر أجهّز **مشروع أندرويد جاهز** في المستودع (`android/`) بنفس الخطة (الغلاف + الـ Manifest + التعديلات الصغيرة في `keys.js` و`router.js`) تفتحه في Android Studio وتبنيه، بشرط تقول لي: **تقصد Android TV / صندوق، ولا موبايل، ولا الاتنين؟** ومعاها نوع الجهاز اللي هتجرّب عليه. بدون SDK هنا مش هقدر أضمن إنه بيتبني، فهكتب إن المشروع لسه ماتجمّعش لحد ما تجرّبه.
