import { createMiddleware } from 'npm:hono@4.7.2/factory';
import { getConfig } from '@api/src/config.ts';
import { verifyJwt } from '@api/src/utils/jwt.ts';

type Variables = {
  admin: {
    adminId: string;
    email: string;
    role: string;
  };
};

export const authMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);
  const payload = await verifyJwt(token, getConfig().jwtSecret);
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('admin', {
    adminId: payload.sub,
    email: payload.email,
    role: payload.role,
  });
  await next();
});
