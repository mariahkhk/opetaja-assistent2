# Privaatsuspoliitika

Viimati uuendatud: 2026-04-25

Käesolev privaatsuspoliitika kirjeldab, kuidas brauserilaiendus **Õpetaja Assistent 2** (edaspidi "laiendus") töötleb õpetajate, õpilaste ja kooli andmeid. Laiendus on vabavaraline tööriist, mis jookseb täielikult kasutaja brauseris ning täiendab Tahveli (tahvel.edu.ee) kasutusliidest.

## Vastutav töötleja

Laiendust arendab ja haldab `kriit-eu` meeskond. Lähtekood on avalik aadressil <https://github.com/kriit-eu/opetaja-assistent2>.

## Mis andmeid laiendus töötleb

Laiendus töötleb **ainult andmeid, mis on Tahveli kaudu juba õpetajale kättesaadavad**. Laiendus ei kogu midagi kasutaja taustal — kogu töötlus käivitub Tahveli kasutamise ajal.

Töödeldavad andmeliigid:

- Õpilaste täisnimed ning isikukoodid (kasutame neid Tahveli ja Kriidi vahel sünkroniseerimisel)
- Õpilaste hinded, hindelised ülesanded ja kohalkäimine
- Õpetajate nimed ning isikukoodid
- Päeviku-, kursuse- ja tunniplaani andmed
- Kooli ja õppeaasta üldandmed

## Kus andmeid hoitakse

Andmed liiguvad kahe asukoha vahel:

1. **Kasutaja brauseri vahemälu** (kohalik). Laiendus salvestab Tahvelist toodud vastused vahemällu, et lehed laeksid kiiremini. Õpilaste ja õpetajate nimed ning isikukoodid hoitakse ainult brauseri mälus ega kirjutata kettale. Ülejäänud kettale jõudvad andmed on AES-256-GCM krüpteeritud.
2. **Kriidi server** (võrgupäring). Kui kasutaja on Kriidi sünkroniseerimise sisse lülitanud, saadab laiendus eelmainitud andmed kasutaja konfigureeritud Kriidi serverisse (vaikimisi `https://kriit.vikk.ee/api`). Laiendus lubab ainult HTTPS-ühendusi (erandiks `localhost` arendamise jaoks). **Kriidi-serveri andmekaitse on vastava Kriidi paigalduse omaniku vastutus.**

Laiendus **ei saada andmeid ühelegi muule kolmandale osapoolele** — ei reklaamipartneritele, analüütikateenustele ega Google'i pilve. Laienduse seaded ja API võtmed hoitakse `chrome.storage.local`-is, mis erinevalt `chrome.storage.sync`-ist ei sünkroniseeru Google'i serveritesse.

## Säilitamise tähtaeg

- Iga vahemälukirjel on individuaalne aegumistähtaeg (1 minutist kuni 30 päevani sõltuvalt andmete liigist).
- Laiendus käivitab iga kuue tunni järel automaatse kontrolli (ajal mil mõni Tahveli vahekaart on lahti), mis kustutab aegunud kirjed. Kontroll käivitub samuti, kui kasutaja avab või aktiveerib Tahveli vahekaardi.
- Kogu vahemälu tühjendatakse iga laienduse versiooniuuenduse korral, sealjuures uuendatakse ka krüpteerimisvõti.
- Vahemälu **säilib** brauseri sulgemisel ja Tahvelist väljalogimisel — andmed jäävad krüpteeritult kettale, kuni nende individuaalne aegumistähtaeg saab täis või kasutaja ise vahemälu tühjendab.
- Kasutaja võib igal hetkel käsitsi tühjendada kogu vahemälu laienduse hüpikaknast (nupp "Tühjenda vahemälu"). **Jagatud arvutil on soovitatav vahemälu enne lahkumist tühjendada.**
- Laienduse desinstallimisel kustutab Chrome automaatselt kõik laienduse poolt salvestatud andmed.

## Vea-aruandlus (Sentry)

Laiendus kasutab Sentry teenust, et koguda anonümiseeritud veateateid (nt. nimi, virnajälg, brauseriversioon). Veateated **ei sisalda õpilaste, õpetajate ega kooli andmeid** — laiendus filtreerib need välja enne saatmist. Vea-aruandlus toimub HTTPS-i kaudu Sentry pilve.

## Silumisrežiim

Kui kasutaja lülitab silumisrežiimi sisse (laienduse hüpikaken), salvestab laiendus mõneks ajaks võrgupäringute metaandmeid (URL, staatus). **Päringute sisus olevad õpilaste isikuandmed asendatakse silumisbufferis automaatselt tähistega `[REDACTED-PII]`** — silumisfailides ei saa olla õpilaste nimesid ega isikukoode.

## Kasutaja õigused (GDPR)

Vastavalt isikuandmete kaitse üldmäärusele on kasutajal õigus:

- **Tutvuda enda andmetega** — laiendus ei hoia andmeid kasutaja brauserist väljaspool, seega kõigi kogutud andmete üle on kasutajal täielik kontroll.
- **Andmete kustutamine** — vajutage hüpikaknas nuppu "Tühjenda vahemälu" või eemaldage laiendus.
- **Töötlemise piiramine** — saate igal hetkel laienduse keelata Chrome'i laienduste haldajas.
- **Vastuväited** — kui te ei soovi laiendusega andmeid töödelda, eemaldage laiendus.

Kuna kõik andmed on kasutaja seadmes ja Kriit on kooli/asutuse hallatav süsteem, ei toimu rahvusvahelist andmete edastust laienduse poolt. Kriidi puhul määrab edastusreeglid Kriidi paigalduse haldaja.

## Laste privaatsus

Laiendus on suunatud kutseõppeasutuste **õpetajatele**. Õpilastele on Tahveli ja Kriidi süsteemid suunatud nende kooli/lapsevanema kaudu. Laiendus ei kogu eraldi õpilaste nõusolekut — kõik andmed liiguvad nende kohta nende kooli ja Kriidi paigalduse õiguslikul alusel.

## Muudatused

Selle privaatsuspoliitika muudatused avaldatakse laienduse Git-repositooriumis koos kommitiloendiga. Olulisi muudatusi (nt. uue kolmanda osapoole lisamine) teavitame laienduse hüpikaknas.

