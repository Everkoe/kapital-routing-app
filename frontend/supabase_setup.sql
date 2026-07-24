CREATE TABLE IF NOT EXISTS public.app_state (
  id integer PRIMARY KEY,
  usuarios jsonb DEFAULT '{}'::jsonb,
  rutas jsonb DEFAULT '[]'::jsonb
);

INSERT INTO public.app_state (id, usuarios, rutas)
VALUES (1, '{}'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;
