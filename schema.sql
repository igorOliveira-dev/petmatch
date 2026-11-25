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

-- ===== Versão 2: regras do Termo de Aceite (migrações seguras para bancos já existentes) =====
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nascimento          DATE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado_em TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS documento           TEXT;        -- documentação da parceria (data URL)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS documento_nome      TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS homologado_em       TIMESTAMPTZ; -- ONG/protetor aprovado pelo admin
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS parceria_recusa     TEXT;        -- motivo, se a parceria foi recusada
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS suspenso_em         TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS termo_versao        TEXT;        -- versão do termo que o usuário aceitou

ALTER TABLE pets ADD COLUMN IF NOT EXISTS taxa        NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (taxa >= 0); -- castração/vacinação
ALTER TABLE pets ADD COLUMN IF NOT EXISTS adotado_por TEXT REFERENCES usuarios(email) ON DELETE SET NULL;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS adotado_em  TIMESTAMPTZ;

-- Solicitações de adoção: em_analise -> entrevista -> aprovada | reprovada  (ou cancelada pelo adotante)
CREATE TABLE IF NOT EXISTS solicitacoes (
  id                  SERIAL PRIMARY KEY,
  pet_id              INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  adotante_email      TEXT NOT NULL REFERENCES usuarios(email) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'em_analise'
                      CHECK (status IN ('em_analise', 'entrevista', 'aprovada', 'reprovada', 'cancelada')),
  respostas           JSONB NOT NULL,          -- questionário de triagem
  entrevista_em       TIMESTAMPTZ,
  parecer             TEXT,                    -- parecer da entrevista (obrigatório para aprovar)
  justificativa       TEXT,                    -- obrigatória ao reprovar; o adotante vê
  primeiro_retorno_em TIMESTAMPTZ,             -- prazo: até 7 dias depois de criado_em
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- no máximo uma solicitação ativa por adotante para o mesmo pet
CREATE UNIQUE INDEX IF NOT EXISTS solicitacao_ativa_unica ON solicitacoes (pet_id, adotante_email)
  WHERE status IN ('em_analise', 'entrevista');

-- Canal de contato e denúncia
CREATE TABLE IF NOT EXISTS mensagens (
  id            SERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('contato', 'denuncia')),
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL,
  pet_id        INTEGER REFERENCES pets(id) ON DELETE SET NULL,
  mensagem      TEXT NOT NULL,
  usuario_email TEXT REFERENCES usuarios(email) ON DELETE SET NULL,
  resolvida_em  TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auditoria das operações sobre dados pessoais (sem FK: o registro fica mesmo se o usuário for excluído)
CREATE TABLE IF NOT EXISTS auditoria (
  id       SERIAL PRIMARY KEY,
  quando   TIMESTAMPTZ NOT NULL DEFAULT now(),
  autor    TEXT,           -- quem fez (e-mail) ou NULL se anônimo
  acao     TEXT NOT NULL,
  alvo     TEXT,           -- de quem/qual registro
  detalhes JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS auditoria_quando ON auditoria (quando DESC);
