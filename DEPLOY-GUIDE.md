# LeadFlow Backend — Deploy Guide

Ovaj guide te vodi od nule do live backend servera na Railway.app.
Posle ovoga, LeadFlow forma će moći da šalje leadove direktno u GHL.

---

## DEO 1: Napravi GitHub nalog i repo

### 1.1 Kreiraj GitHub nalog
1. Otvori **https://github.com**
2. Klikni **"Sign up"**
3. Unesi email, password, username
4. Verifikuj email

### 1.2 Kreiraj novi repository
1. Na GitHub-u klikni **"+"** (gore desno) → **"New repository"**
2. Repository name: **leadflow-api**
3. Ostavi "Public" selektovano
4. **NE** čekiraj "Add a README file"
5. Klikni **"Create repository"**
6. Ostaće ti otvorena stranica sa instrukcijama — NE zatvaraj je

---

## DEO 2: Upload fajlova na GitHub

### Najlakši način (bez Git-a, direktno u browseru):

1. Na stranici tvog novog repo-a, klikni link **"uploading an existing file"**
   (piše: "…or upload an existing file")
2. Prevuci ova 4 fajla sa desktopa u browser:
   - `server.js`
   - `package.json`
   - `railway.toml`
   - `.gitignore`
3. Dole gde piše "Commit changes", ostavi default poruku
4. Klikni **"Commit changes"**

Sad imaš sve fajlove na GitHub-u!

---

## DEO 3: Deploy na Railway

### 3.1 Kreiraj Railway nalog
1. Otvori **https://railway.app**
2. Klikni **"Login"** → **"Login with GitHub"**
3. Autorizuj Railway da pristupi tvom GitHub-u

### 3.2 Kreiraj novi projekat
1. Na Railway dashboardu klikni **"New Project"**
2. Izaberi **"Deploy from GitHub Repo"**
3. Nađi **leadflow-api** repo i klikni na njega
4. Railway će automatski detektovati Node.js i početi deploy

### 3.3 Generiši public URL
1. Kad deploy završi (zeleni ✓), klikni na servis
2. Idi na tab **"Settings"**
3. Skroluj do sekcije **"Networking"** → **"Public Networking"**
4. Klikni **"Generate Domain"**
5. Dobijaš URL poput: **https://leadflow-api-production-xxxx.up.railway.app**
6. **SAČUVAJ OVAJ URL** — trebamo ga za frontend

### 3.4 Testiraj
Otvori browser i idi na:
```
https://tvoj-railway-url.up.railway.app/api/health
```
Trebalo bi da vidiš: `{"status":"ok"}`

---

## DEO 4: Poveži frontend

Kad dobiješ Railway URL, vrati se u Claude chat i daj mi URL.
Ja ću updejovati LeadFlow Builder app da koristi tvoj live server
umesto localhost:3001.

---

## ČESTA PITANJA

### "Railway traži kreditnu karticu"
Railway free tier daje $5 kredita mesečno bez kartice.
Ako traži karticu, to znači da si prešao limit — ali za ovaj
mali API server nećeš jer troši ~$0.50/mesečno.

### "Deploy failed"
- Proveri da si uploadovao sva 4 fajla
- Proveri da `package.json` ima tačne dependencies
- Na Railway-u klikni na "Deployments" tab da vidiš error log

### "Dobijam 502 Bad Gateway"
Server se još pokreće. Sačekaj 30 sekundi i probaj opet.

### "Kako da updejtujem server?"
Na GitHub-u edituj fajl direktno (klikni na fajl → olovka ikonica → edituj → commit).
Railway automatski redeploy-uje kad se promeni GitHub repo.
