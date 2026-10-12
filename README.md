# FM-Goal

Simulatore web della carriera di un allenatore di calcio, a decisioni stagionali: una carriera completa in pochi minuti, dalla Primavera alle grandi panchine.

Stato: **fetta verticale giocabile.** Si gioca su https://cpernice17.github.io/FM-Goal/ (dopo l'attivazione di GitHub Pages). Campionati: Italia, Inghilterra, Spagna, Germania e Francia (prima e seconda divisione), Portogallo, Paesi Bassi, Brasile, Argentina, Arabia Saudita, Giappone e MLS, con coppe nazionali e campionati giovanili. Coppe continentali con i formati reali 2026/27 (nomi inventati), supercoppe, trofeo intercontinentale e mondiale per club ogni quattro anni. Eventi in italiano.

## Comandi

```bash
npm install          # TypeScript, tsx, Vite
npm run dev          # gioco in locale con ricaricamento automatico
npm run build        # versione da pubblicare, in dist/
npm test             # test del motore
npm run typecheck    # controllo dei tipi
npm run validate     # controllo dei pacchetti di eventi (--strict: anche en/es)
npm run sim          # simula 2000 carriere e stampa le statistiche
npm run sim -- --n=500 --seed=3 --policy=random --difficulty=hard
```

## Senza installare nulla

Ogni push su `main` esegue tipi, test, controllo degli eventi e una simulazione di 300 carriere (scheda **Actions** del repository, poi l'ultima esecuzione: i risultati sono nel riepilogo). Per una simulazione con parametri diversi: **Actions → Test e simulazione → Run workflow**.

Ogni push su `main` pubblica anche il gioco su GitHub Pages (workflow **Pubblica il gioco**). Va attivato una volta: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Struttura

```
src/
  engine/            logica pura, nessuna dipendenza dal browser
    rng.ts           generatore casuale con seed (salvabile)
    match.ts         modello partita (gol come estrazioni di Poisson)
    competition.ts   campionato all'italiana e coppa a eliminazione diretta
    world.ts         mondo: club, campionati, Primavera, promozioni, evoluzione dei rating
    continental.ts   coppe continentali, supercoppe, intercontinentale, mondiale per club
    squad.ts         giocatori chiave generati
    career.ts        ciclo della stagione, variabili, offerte, esonero, riepilogo finale
    events/          formato degli eventi, esecuzione, validatore
  content/
    index.ts         registro di paesi e pacchetti di eventi
    events/*.json    pacchetti di eventi
  data/
    countries/*.json club e campionati per paese (istantanea 2026/27)
    continental.json coppe internazionali, posti per paese, club esterni dei paesi non simulati
    names.json       nomi per i giocatori generati
  i18n/              testi dell'interfaccia
  ui/                interfaccia (TypeScript senza framework) e foglio di stile
scripts/             simulatore di carriere e validatore
tests/               test del motore
```

## Ciclo di una stagione (API del motore)

```
createCareer → startSeason → [choose]* → playSeason → prepareEnd → [choose]* → nextSeason → …
```

`state.phase` indica il passo successivo; `state.pending` contiene la decisione da mostrare. Tutto lo stato è un oggetto JSON: `serialize` / `deserialize` per il salvataggio.

## Aggiungere contenuti

- **Un pacchetto di eventi**: crea `src/content/events/<nome>.json` e aggiungilo in `src/content/index.ts`, poi `npm run validate`.
- **Un paese**: crea `src/data/countries/<id>.json` con campionati, club e club esterni, e aggiungilo in `src/content/index.ts`.

Regole di scrittura degli eventi: corpo di massimo due righe, opzioni di massimo otto parole, mai un articolo davanti a `{club}` o `{giocatore}`, ogni opzione è un compromesso.

## Bilanciamento

Tutti i parametri sono in `BALANCE` (`career.ts`), `MATCH` (`match.ts`), `WORLD` (`world.ts`) e `SQUAD` (`squad.ts`). Si modificano e si verifica l'effetto con `npm run sim`.

Rating e profili di stile dei club sono stime iniziali, da rivedere.
