import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParams } from '@shared/schemas/common';
import { categoryCreateSchema, categoryUpdateSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { isForeignKeyViolation, isUniqueViolation } from '../../db/index';

interface CategoryRow {
  id: string;
  parentId: string | null;
  kind: 'expense' | 'income';
  systemKey: string | null;
  name: string | null;
  icon: string;
  color: string;
  sortOrder: number;
  isArchived: boolean;
}

const SELECT = `SELECT id, parent_id AS "parentId", kind, system_key AS "systemKey", name, icon, color, sort_order AS "sortOrder", is_archived AS "isArchived" FROM categories`;

export async function registerCategoryRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/categories',
    defineRoute({
      query: z.object({ kind: z.enum(['expense', 'income']).optional(), includeArchived: z.coerce.boolean().default(false) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const conditions = ['user_id = $1'];
        const params: unknown[] = [auth.user.id];
        if (query.kind) {
          params.push(query.kind);
          conditions.push(`kind = $${params.length}`);
        }
        if (!query.includeArchived) conditions.push('NOT is_archived');
        const rows = await db.query<CategoryRow>(`${SELECT} WHERE ${conditions.join(' AND ')} ORDER BY (parent_id IS NOT NULL), sort_order, id`, params);
        // usage counts help the UI warn before archiving/deleting
        const usage = await db.query<{ categoryId: string; n: number }>(
          `SELECT category_id AS "categoryId", COUNT(*)::int AS n FROM transaction_lines WHERE user_id = $1 GROUP BY category_id`,
          [auth.user.id],
        );
        const usageMap = new Map(usage.map((u) => [u.categoryId, u.n]));
        return { categories: rows.map((r) => ({ ...r, transactionCount: usageMap.get(r.id) ?? 0 })) };
      },
    }),
  );

  app.post(
    '/api/categories',
    defineRoute({
      body: categoryCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        if (body.parentId) {
          const parent = await db.one<{ kind: string }>(`SELECT kind FROM categories WHERE id = $1 AND user_id = $2`, [body.parentId, auth.user.id]);
          if (!parent) throw AppError.notFound('Parent category');
          if (parent.kind !== body.kind) throw AppError.validation([{ path: 'parentId', message: 'validation.invalid_option' }]);
        }
        try {
          const row = await db.one<CategoryRow>(
            `INSERT INTO categories (user_id, parent_id, kind, name, icon, color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, parent_id AS "parentId", kind, system_key AS "systemKey", name, icon, color, sort_order AS "sortOrder", is_archived AS "isArchived"`,
            [auth.user.id, body.parentId ?? null, body.kind, body.name, body.icon, body.color],
          );
          return { category: row };
        } catch (e) {
          if (isUniqueViolation(e, 'categories_user_name_key')) throw new AppError('CONFLICT', 'A category with this name already exists here.');
          throw e;
        }
      },
    }),
  );

  app.patch(
    '/api/categories/:id',
    defineRoute({
      params: idParams,
      body: categoryUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one<CategoryRow>(`${SELECT} WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Category');
        // Default categories keep their translation key (`systemKey`); setting `name` here simply overrides
        // the localised label with a custom one — both `SELECT` and the web app already prefer `name` when set.
        try {
          const row = await db.one<CategoryRow>(
            `UPDATE categories SET name = COALESCE($3, name), icon = COALESCE($4, icon), color = COALESCE($5, color),
                                    sort_order = COALESCE($6, sort_order), is_archived = COALESCE($7, is_archived)
             WHERE id = $1 AND user_id = $2
             RETURNING id, parent_id AS "parentId", kind, system_key AS "systemKey", name, icon, color, sort_order AS "sortOrder", is_archived AS "isArchived"`,
            [params.id, auth.user.id, body.name ?? null, body.icon ?? null, body.color ?? null, body.sortOrder ?? null, body.isArchived ?? null],
          );
          return { category: row };
        } catch (e) {
          if (isUniqueViolation(e, 'categories_user_name_key')) throw new AppError('CONFLICT', 'A category with this name already exists here.');
          throw e;
        }
      },
    }),
  );

  app.delete(
    '/api/categories/:id',
    defineRoute({
      params: idParams,
      query: z.object({ reassignTo: z.string().uuid().optional() }),
      handler: async ({ params, query, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one<{ id: string }>(`SELECT id FROM categories WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Category');
        const hasChildren = await db.one(`SELECT 1 FROM categories WHERE parent_id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (hasChildren) throw new AppError('CONFLICT', 'Delete or move its subcategories first.');

        if (query.reassignTo) {
          const target = await db.one<{ id: string }>(`SELECT id FROM categories WHERE id = $1 AND user_id = $2`, [query.reassignTo, auth.user.id]);
          if (!target) throw AppError.notFound('Target category');
          await db.tx(async (tx) => {
            await tx.exec(`UPDATE transactions SET category_id = $3 WHERE category_id = $1 AND user_id = $2`, [params.id, auth.user.id, query.reassignTo]);
            await tx.exec(`UPDATE transaction_splits SET category_id = $3 WHERE category_id = $1 AND user_id = $2`, [params.id, auth.user.id, query.reassignTo]);
            await tx.exec(`UPDATE recurring_transactions SET category_id = $3 WHERE category_id = $1 AND user_id = $2`, [params.id, auth.user.id, query.reassignTo]);
            // A budget that already has a line for the target category would collide with UNIQUE(budget_id, category_id) —
            // drop the old-category line there instead of merging amounts, then move every remaining line over.
            await tx.exec(
              `DELETE FROM budget_items WHERE category_id = $1 AND user_id = $2 AND budget_id IN (SELECT budget_id FROM budget_items WHERE category_id = $3 AND user_id = $2)`,
              [params.id, auth.user.id, query.reassignTo],
            );
            await tx.exec(`UPDATE budget_items SET category_id = $3 WHERE category_id = $1 AND user_id = $2`, [params.id, auth.user.id, query.reassignTo]);
            await tx.exec(`DELETE FROM categories WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
          });
          return { ok: true };
        }

        try {
          await db.exec(`DELETE FROM categories WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
          return { ok: true };
        } catch (e) {
          if (isForeignKeyViolation(e)) throw new AppError('CATEGORY_IN_USE');
          throw e;
        }
      },
    }),
  );
}
