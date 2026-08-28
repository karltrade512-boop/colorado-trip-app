export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Moon = {
  phase?: string;
  illumination_pct?: number | null;
  moonrise?: string | null;
  moonset?: string | null;
  astronomical_dusk?: string | null;
  dark_window?: [string, string] | string[] | null;
  verdict?: string | null;
};

export type Light = {
  sunrise?: string;
  sunset?: string;
  golden_am?: string[];
  golden_pm?: string[];
  civil_dawn?: string;
  civil_dusk?: string;
  thermals?: string[];
  moon?: Moon;
};

export type Place = {
  id?: string;
  name?: string;
  lat?: number | null;
  lon?: number | null;
  lng?: number | null;
  tz?: string;
  check_in?: string | null;
  elevation_display?: string | null;
  elevation_confirmed?: boolean;
  elevation_ft_measured?: number | null;
  elevation_ft_range?: number[] | null;
  [k: string]: unknown;
};

export type Day = {
  date: string;
  kind?: string | null;
  base?: string | null;
  run?: string | null;
  from?: string | null;
  to?: string | null;
  light?: Light;
  light_computed_for?: string;
  [k: string]: unknown;
};

export type Run = {
  from?: string;
  to?: string;
  arrive_by?: string;
  overnight?: string;
  note?: string;
  [k: string]: unknown;
};

export type Trip = {
  name?: string;
  first_day?: string;
  last_day?: string;
  shape?: string;
  region?: string;
  subjects?: string[];
  detour_minutes?: number;
  hike_miles_each_way?: number[];
  visited?: string[];
  preferences?: {
    dogs?: boolean;
    night_sky?: boolean;
    no_early_mornings?: boolean;
    no_early_mornings_meaning?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

export type TripBundle = {
  schema_version?: string;
  generated?: string;
  contract?: Record<string, unknown>;
  trip?: Trip;
  places?: Record<string, Place> | Place[];
  runs?: Record<string, Run> | Run[];
  days?: Day[];
  [k: string]: unknown;
};

export type NamedItem = {
  id: string;
  name: string;
  raw: Record<string, unknown>;
};

export type LiveResult = {
  url: string;
  ok: boolean;
  fetchedAt: string;
  status?: number;
  error?: string;
  kind: "webcam" | "gate";
  label: string;
};

export type UnverifiedExtra = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: string;
  unverified: true;
};
