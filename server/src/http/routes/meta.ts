import type { FastifyInstance } from 'fastify';
import { defineRoute } from '../route';
import { config } from '../../config';

export interface PublicSettings {
  registrationOpen: boolean;
  maintenanceMode: boolean;
  demoEnabled: boolean;
  announcement: string | null;
}

export async function readPublicSettings(db: FastifyInstance['db']): Promise<PublicSettings> {
  const rows = await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM system_settings WHERE key IN ('registration_open','maintenance_mode','demo_enabled','announcement')`);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    registrationOpen: (map.get('registration_open') as boolean | undefined) ?? true,
    maintenanceMode: (map.get('maintenance_mode') as boolean | undefined) ?? false,
    demoEnabled: config.demoEnabled && ((map.get('demo_enabled') as boolean | undefined) ?? true),
    announcement: (map.get('announcement') as string | null | undefined) ?? null,
  };
}

export async function registerMetaRoutes(app: FastifyInstance): Promise<void> {
  // /api/healthz is registered once, directly in app.ts (it needs to exist before the rest of the app
  // finishes wiring up, so monitoring can hit it even during a slow boot).

  app.get(
    '/api/meta/currencies',
    defineRoute({
      handler: async () =>
        app.db.query(`SELECT code, name, symbol, minor_units AS "minorUnits", display_decimals AS "displayDecimals" FROM currencies WHERE is_active ORDER BY sort_order`),
    }),
  );

  app.get(
    '/api/meta/config',
    defineRoute({
      handler: async () => {
        const settings = await readPublicSettings(app.db);
        return { ...settings, aiEnabled: !!config.ai.apiKey, pushEnabled: !!config.vapid.publicKey, vapidPublicKey: config.vapid.publicKey ?? null, env: config.env };
      },
    }),
  );
}
