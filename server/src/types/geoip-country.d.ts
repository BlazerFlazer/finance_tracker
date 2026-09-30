declare module 'geoip-country' {
  export interface GeoIpLookup {
    range: [number, number];
    country: string;
    name?: string;
    native?: string;
    continent?: string;
    continent_name?: string;
  }
  export function lookup(ip: string): GeoIpLookup | null;
}
