# Õpetaja Assistent 2: hinded GitHubist ja Classroom 50-st Tahvlisse

Õpetaja Assistent 2 on Chrome'i laiendus, mis kannab Classroom 50 (GitHub) ülesannete tulemused Tahvli päevikusse. Lisaks hinnetele saab laiendus täita sissekande tunni sisu, kodutöö ja tähtaja ning kontrollida päeviku vastavust tunniplaanile.

Laiendus kasutab sinu olemasolevat Tahvli sisselogimist, eraldi kasutajakontot pole vaja. GitHubi andmete lugemiseks on vaja juurdepääsuluba (*token*), mille lood ise (vt punkt 2).

## 1. Paigaldamine

1. Laadi alla fail `opetaja-assistent2-v<versioon>.zip` selle repositooriumi **Releases** lehelt, mille kaudu sinu kool laiendust jagab (`https://github.com/<omanik>/opetaja-assistent2/releases`).
2. Paki fail lahti püsivasse kausta. Laiendus töötab sellest kaustast, seega ära kausta hiljem kustuta ega teisalda.
3. Ava Chrome'is aadress `chrome://extensions`, lülita sisse **Arendaja režiim** (*Developer mode*), vali **Laadi lahtipakitud** (*Load unpacked*) ja seejärel eelmises sammus loodud kaust.

**Uuendamine.** Paki uus versioon samasse kausta, vajuta `chrome://extensions` lehel laienduse juures värskendamise nuppu (↻) ja laadi Tahvli leht uuesti (F5).

Laienduse eemaldamisel kustuvad ka salvestatud juurdepääsuload ja seaded. Uuendamiseks pole eemaldamist vaja.

## 2. Juurdepääsuluba

Iga GitHubi organisatsiooni jaoks, mille Classroom 50 andmeid soovid kasutada, on vaja eraldi juurdepääsuluba.

1. Ava <https://github.com/settings/personal-access-tokens/new>.
2. Täida väljad:

   | Väli | Väärtus |
   |---|---|
   | Resource owner | organisatsioon, kus asub repositoorium `classroom50` |
   | Repository access | ainult `classroom50` |
   | Permissions → Contents | Read-only |
   | Permissions → Actions | Read and write (valikuline; vajalik ainult nupu **Uuenda scores.json** jaoks) |
   | Expiration | semestri lõpp |

   Kui organisatsioon nõuab juurdepääsulubade kinnitamist, jõustub luba alles pärast seda, kui organisatsiooni omanik on selle GitHubis kinnitanud.
3. Ava laienduse aken (tööriistariba ikoon), vali **Hinnete allikas: Classroom 50**, kleebi juurdepääsuluba ja vajuta **Salvesta**. Organisatsioon tuvastatakse loa põhjal automaatselt.

Laienduse aken kontrollib salvestatud lube iga avamisel ja näitab iga organisatsiooni loa olekut:

| Olek | Tähendus |
|---|---|
| `✓ <organisatsioon> · kehtib kuni …` | Luba kehtib. Kui aegumiseni on alla 14 päeva, on rida punane ja lisatud „aegub varsti”. |
| `… AEGUNUD, lisa uus` | Luba on aegunud. |
| `✗ <organisatsioon> — token ei kehti` | Luba on tühistatud või vale. |
| `⚠ <organisatsioon> — token ei näe repot classroom50` | Loal puudub juurdepääs repositooriumile `classroom50`. |

Kõigil kolmel viimasel juhul loo GitHubis uus luba ja lisa see nupuga **+ Lisa token**. Vana loa saad eemaldada nupuga **Kustuta**.

Juurdepääsuluba on isiklik. Ära jaga seda teistega ega salvesta ühiskasutatavatesse failidesse.

## 3. Classroom 50 seadistamine

### Nimetamine

Laiendus seob classroomi Tahvli päevikuga rühma tähise järgi. Seepärast peab classroomi nimi algama rühma tähisega.

| Objekt | Reegel | Näide |
|---|---|---|
| Classroom | `<rühm>-<aine>`, väiketähtedega | `it24-automatiseerimine` |
| Alamrühma classroom (valikuline) | lõppu `-gr1`, `-gr2` | `it26-avalused-gr1` |
| Ülesanne | `Lab NN - <teema>` | `Lab 03 - Ansible (nginx)` |

Üldjuhul on ühel rühmal ühe aine kohta üks classroom ja alamrühmade päevikud (gr1, gr2 jne) kasutavad seda ühiselt. Eraldi classroom alamrühma kohta on vajalik ainult siis, kui alamrühmadel on erinevad ülesanded.

### Ülesande väljad ja Tahvli sissekanne

| Classroom 50 | Tahvli sissekanne |
|---|---|
| Ülesande nimi ja `Teooria:` rida | Tunni sisu |
| Kirjeldus (ilma `Teooria:` reata) | Kodutöö |
| Avaldamise kuupäev (*Release date*) ja tähtaeg | Määravad, millise tunni sissekandega ülesanne seotakse (vt allpool) |
| Tähtaeg (*Due date*) | Kodutöö tähtaeg |
| Automaattestide tulemus | Hinne |

Ülesande kirjeldus on soovitatav koostada kõigis kursustes ühtemoodi:

```
Teooria: <teema> — <link>
<mida teha>. <mida esitada>. Juhend: <link>
```

### Ülesande sidumine sissekandega

Laiendus otsib ülesandele sissekande järgmises järjekorras:

1. sissekanne, mille nimes või sisus on ülesande silt `gh:<ülesanne>` (nt `gh:lab03`);
2. sissekanne, mille nimi on sama mis ülesande nimi;
3. varaseim sissekanne ülesande avaldamise kuupäeva ja tähtaja vahel.

Kui automaatne valik on vale, saab seose paneelil muuta (vt punkt 4). Silt `gh:<ülesanne>` jääb sissekandesse alles ka siis, kui laiendus sissekande teksti uuendab.

### Tekst

Kirjeldus sisestatakse Classroom 50-s üks kord ja kõik selle classroomiga seotud päevikud saavad sama teksti. Õpetaja poolt sissekandesse lisatud tekst säilib; laiendus lisab oma teksti selle kõrvale.

## 4. Hinnete kandmine Tahvlisse

1. Uuenda tulemused: käivita Classroom 50-s **Collect** või vajuta paneeli vaates **Seaded** nuppu **Uuenda scores.json (Classroom 50)**. Tulemused uuenevad 1–2 minuti jooksul.
2. Ava Tahvlis päevik ja vajuta lehe paremas alanurgas nuppu **Classroom 50**.
3. Kontrolli, et iga ülesanne on seotud õige sissekandega. Vajaduse korral vali rippmenüüst teine sissekanne või **— ei kirjuta —**.
4. Märgi read, mida soovid salvestada, ja vajuta **Kirjuta valitud hinded Tahvlisse**.

Paneeli nupu **Seaded** all saab muuta hindamise viisi:

- **Hindamine:** *Automaatne* kasutab sama hindamisviisi, mis sissekandes juba on (muidu 1–5). *Eristav 1–5* ja *Mitteeristav A / MA* määravad hindamisviisi ise.
- **Piirid:** vaikimisi 5: ≥ 90 %, 4: ≥ 75 %, 3: ≥ 50 %, 2: ≥ 20 %, muidu 1. Mitteeristava hindamise korral on A piir sama mis hinde 3 piir (vaikimisi 50 %). Piire saab muuta.
- **Esitamata töö, kui tähtaeg on möödas:** *Ei pane hinnet*, *2* või *1* (mitteeristava hindamise korral MA). Tähtaeg võetakse Classroom 50 ülesande tähtajast.

Tahvlis juba olemasolevaid hindeid ei muudeta. Nende asendamiseks märgi paneelil **Kirjuta üle ka olemasolevad hinded**.

Samas paneelis asub ka jaotis **Tunni sisu ja kodutöö**, mis täidab sissekande sisu, kodutöö ja tähtaja punktis 3 kirjeldatud reeglite järgi.

## 5. Päeviku kontroll tunniplaani vastu

Laiendus võrdleb päevikut tunniplaaniga ja näitab leitud erinevused päeviku kohal.

| Teade | Toiming |
|---|---|
| Sissekanne ei vasta tunniplaanile | **Muuda** parandab olemasoleva sissekande, **Lisa** või **Lisa kõik** lisab puuduvad tunnid |
| Õppevormi märge puudub (auditoorne või praktiline õpe) | **Paranda** |
| Iseseisvaid töid on mahuga võrreldes liiga vähe või liiga palju | Lisa või eemalda iseseisva töö sissekandeid |

## 6. Probleemide lahendamine

| Probleem | Lahendus |
|---|---|
| Teade „Extension context invalidated” | Laadi Tahvli leht uuesti (F5). |
| Nuppu **Classroom 50** ei ole | Vali laienduse aknas **Hinnete allikas: Classroom 50** ja laadi Tahvli leht uuesti. |
| „Faili ei leitud” või tühi tulemus | Kontrolli, et organisatsiooni juurdepääsuluba on lisatud ja kehtib. Käivita Classroom 50-s **Collect**. |
| Ülesanded on seotud valede sissekannetega | Vajuta paneelil **Lähtesta seosed** ja kontrolli seoseid uuesti. |

## Lisa: hinded tavalisest GitHubi repositooriumist

Kui Classroom 50 ei ole kasutusel, saab hinded lugeda GitHubi repositooriumis olevast tabelist.

1. Vali laienduse aknas **Hinnete allikas: GitHub**.
2. Lisa repositooriumisse CSV-fail või Markdowni tabel järgmiste veergudega (näide: [naidis-hinded.csv](naidis-hinded.csv)):

   | Veerg | Kohustuslik |
   |---|---|
   | Ülesanne | jah |
   | Õpilane või GitHub (kasutajanimi) | vähemalt üks |
   | Hinne või Punktid ja Max | vähemalt üks |

3. Sisesta repositoorium ja faili asukoht päeviku paneelil. Seda on vaja teha iga päeviku kohta üks kord.

Avaliku repositooriumi puhul juurdepääsuluba vaja ei ole.
