-- Banco de dados do PetMatch (PostgreSQL).
-- O server.js roda este arquivo ao iniciar, então as tabelas são criadas sozinhas.

CREATE TABLE IF NOT EXISTS usuarios (
  email             TEXT PRIMARY KEY,
  nome              TEXT NOT NULL,
  senha             TEXT NOT NULL,              -- hash scrypt "sal:hash", nunca a senha pura
  doc               TEXT,                       -- CPF/CNPJ
  cep               TEXT,
  whats             TEXT,
  perfil            TEXT NOT NULL CHECK (perfil IN ('adotar', 'doar', 'instituicao', 'admin')),
  extras            JSONB NOT NULL DEFAULT '{}', -- respostas das perguntas do perfil
  aceitou_termos_em TIMESTAMPTZ,                -- quando aceitou os termos de uso
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pets (
  id           SERIAL PRIMARY KEY,
  nome         TEXT NOT NULL,
  idade        INTEGER NOT NULL CHECK (idade >= 0),
  peso         NUMERIC(5,1) NOT NULL CHECK (peso >= 0),
  temperamento TEXT NOT NULL,
  sexo         TEXT NOT NULL CHECK (sexo IN ('Macho', 'Fêmea')),
  vacinacao    TEXT NOT NULL,
  situacao     TEXT NOT NULL,
  especie      TEXT NOT NULL CHECK (especie IN ('Cachorro', 'Gato')),
  cidade       TEXT NOT NULL,
  tutor        TEXT NOT NULL,
  tutor_email  TEXT REFERENCES usuarios(email) ON DELETE CASCADE, -- quem registrou (vazio = pets de exemplo)
  foto         TEXT NOT NULL DEFAULT '',        -- imagem em data URL (jpeg reduzido)
  adotado      BOOLEAN NOT NULL DEFAULT false,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pets de exemplo (só entram se a tabela estiver vazia)
INSERT INTO pets (nome, idade, peso, temperamento, sexo, vacinacao, situacao, especie, cidade, tutor)
SELECT * FROM (VALUES
  ('Luiz', 3, 45, 'Arisco', 'Macho', 'Vacinado', 'Castrado', 'Cachorro', 'São Manuel', 'Liga do bem'),
  ('Pipoca', 2, 4, 'Brincalhona', 'Fêmea', 'Vacinado', 'Castrado', 'Cachorro', 'São Manuel', 'Liga do bem'),
  ('Timão', 1, 30, 'Sociável', 'Macho', 'Vacinado', 'Castrado', 'Cachorro', 'São Manuel', 'Liga do bem'),
  ('Destruidor', 5, 22, 'Agitado', 'Macho', 'Vacinado', 'Castrado', 'Cachorro', 'São Manuel', 'Liga do bem'),
  ('Jurema', 0, 8, 'Dócil', 'Fêmea', 'Vacinado', 'Castrado', 'Cachorro', 'São Manuel', 'Liga do bem'),
  ('Mel', 8, 28, 'Calma', 'Fêmea', 'Vacinado', 'Castrado', 'Cachorro', 'São Manuel', 'Liga do bem')
) AS v
WHERE NOT EXISTS (SELECT 1 FROM pets);
