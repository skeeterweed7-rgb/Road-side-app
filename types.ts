import { Timestamp } from 'firebase/firestore';

export interface Chemical {
  name: string;
  totalOz: number;
  ozPerGal?: number | string;
}

export interface ChemicalState {
    name: string;
    totalOz: number | string;
    ozPerGal?: number | string;
}

export interface WeatherConditions {
  weather?: string;
  temperature?: number;
  windDirection?: string;
  windSpeed?: number;
}

export interface LogEntry {
  id: string;
  roadName: string;
  gallonsUsed: number;
  gallonsLeft: number;
  initialTankVolume?: number;
  chemicalMix: Chemical[];
  weatherConditions: WeatherConditions;
  timestamp: Timestamp;
}

export interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  [key: string]: any;
}
