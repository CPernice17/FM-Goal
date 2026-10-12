import type { EventDef, EventPack } from '../engine/events/schema';
import type { CountryData } from '../engine/types';
import eng from '../data/countries/eng.json';
import esp from '../data/countries/esp.json';
import fra from '../data/countries/fra.json';
import ger from '../data/countries/ger.json';
import ita from '../data/countries/ita.json';
import ned from '../data/countries/ned.json';
import por from '../data/countries/por.json';
import carriera from './events/carriera.json';
import crisi from './events/crisi.json';
import dirigenza from './events/dirigenza.json';
import gavetta from './events/gavetta.json';
import spogliatoio from './events/spogliatoio.json';

/**
 * Registro dei contenuti. Per aggiungere un pacchetto di eventi o un paese:
 * crea il file JSON e aggiungi una riga qui. Lo script `npm run validate`
 * controlla i pacchetti prima di giocarli.
 */
export const EVENT_PACKS: EventPack[] = [carriera, gavetta, spogliatoio, dirigenza, crisi] as unknown as EventPack[];

export const EVENTS: EventDef[] = EVENT_PACKS.flatMap((p) => p.events);

export const COUNTRIES: CountryData[] = [ita, eng, esp, ger, fra, por, ned] as unknown as CountryData[];
