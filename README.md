# AI Studio

Image, Thumbnail, Video (text→video, image→video) আর Bulk generate করার একটা ওয়েবসাইট। সব API Settings পেজ থেকে বসানো/বদলানো যায়, কোড ছুঁতে হয় না।

## চালু করার ধাপ

1. এই ফোল্ডারের সব ফাইল একটা নতুন GitHub repository-তে আপলোড করুন।
2. Netlify → **Add new site → Import from Git** → repository বেছে নিন।
3. Build command ফাঁকা রাখুন, Publish directory `.` (netlify.toml-এ দেওয়া আছে)। Deploy চাপুন।
4. সাইট খুলে **⚙ Settings** এ যান, API key বসান।

## নিরাপত্তা (সাইট পাবলিক হলে অবশ্যই করবেন)

Netlify → Site settings → Environment variables:

| Name | কাজ |
|---|---|
| `STUDIO_PASSCODE` | যেকোনো গোপন পাসওয়ার্ড। এটা দিলে শুধু আপনিই proxy ব্যবহার করতে পারবেন। Settings → Network এ একই পাসওয়ার্ড বসান। |
| `STUDIO_KEY_HF` (নাম আপনার ইচ্ছা, `STUDIO_KEY_` দিয়ে শুরু হতে হবে) | আসল API key। Settings এ key এর জায়গায় লিখুন `{{ENV:STUDIO_KEY_HF}}`। তখন key ব্রাউজারে থাকবে না। |
| `EXTRA_ALLOWED_HOSTS` | নিজের custom API-র হোস্ট (যেমন `api.example.com`), কমা দিয়ে আলাদা করে। |

Settings এ সরাসরি key বসালে সেটা শুধু আপনার ব্রাউজারে (localStorage) থাকে, GitHub-এ যায় না। তবু অন্যের কম্পিউটারে key বসাবেন না।

## নতুন API যোগ করা

Settings → **+ Add custom provider**:

- **Request URL** আর **Headers**: `Authorization: Bearer {{key}}`
- **Body template** (JSON): `{{prompt}}`, `{{width}}`, `{{height}}`, `{{seed}}`, `{{duration}}`, `{{image_base64}}`, `{{image_data_url}}` ব্যবহার করা যায়।
- **Result path**: উত্তরের JSON-এ ছবি/ভিডিও কোথায়, যেমন `data[0].url` বা `data[0].b64_json`।
- ভিডিও API যেগুলো আগে job id দেয়, তাদের জন্য **Status URL** (`.../jobs/{{id}}`) আর **Job id path** দিন।

**Priority** অংশে ↑↓ দিয়ে ঠিক করুন কোন API আগে চেষ্টা হবে। একটা ব্যর্থ হলে বা key না থাকলে পরেরটা নিজে থেকে চলে।

## একই provider-এ একাধিক key

Key-এর বক্সে প্রতি লাইনে একটা key দিন। একটা key-র limit শেষ (429/401/402/403) হলে পরের key নিজে থেকে ব্যবহার হবে। এটা শুধু আপনার নিজের আলাদা key-র জন্য ঠিক আছে। একই সার্ভিসে অনেক ফ্রি অ্যাকাউন্ট খুলে limit এড়ালে সার্ভিসের নিয়ম ভাঙা হয় এবং অ্যাকাউন্ট ব্যান হতে পারে।

## সীমাবদ্ধতা (সত্যি কথা)

- ফ্রি টেক্সট-টু-ভিডিও API প্রায় নেই। Hugging Face-এর ভিডিও মডেল সব সময় ফ্রিতে চলে না।
- **Image → Video** এর জন্য বিল্ট-ইন লোকাল engine আছে (zoom/pan, ব্রাউজারেই তৈরি, ট্যাব খোলা রাখতে হবে, আউটপুট `.webm`)। এটা AI ভিডিও নয়।
- Proxy (Netlify Function) তে সময়সীমা কম এবং রেসপন্স প্রায় 6MB পর্যন্ত। বড় ভিডিও proxy দিয়ে না এনে সরাসরি CORS-সমর্থিত API ব্যবহার করুন।
- ফ্রি সার্ভিসের নাম, মডেল ও URL সময়ের সাথে বদলায়। কিছু কাজ না করলে Settings এ endpoint/model বদলে নিন।

## ফোল্ডার

```
index.html          পেজ
css/style.css       ডিজাইন
js/store.js         সেটিংস সংরক্ষণ
js/net.js           নেটওয়ার্ক + proxy fallback
js/providers.js     সব provider (নতুন বিল্ট-ইন যোগ করতে এখানে)
js/app.js           UI
netlify/functions/proxy.js   CORS proxy + গোপন key
netlify.toml
```
