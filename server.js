/* =====================================================
   server.js - API do PetMatch + arquivos do site (pasta public/)
   Variáveis de ambiente: DATABASE_URL, SEGREDO, ADMIN_SENHA, PORT
   ===================================================== */
const express = require("express");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const fs = require("node:fs");

try { process.loadEnvFile(); } catch {} // lê o .env se existir (rodar local)

const db = new Pool({ connectionString: process.env.DATABASE_URL });
// ponytail: sem SEGREDO fixo, todo mundo é deslogado quando o servidor reinicia
const SEGREDO = process.env.SEGREDO || crypto.randomBytes(32).toString("hex");

/* --- Senhas (scrypt, da própria biblioteca do Node) --- */
const hash = (senha, sal = crypto.randomBytes(16).toString("hex")) =>
  sal + ":" + crypto.scryptSync(String(senha), sal, 64).toString("hex");
const confere = (senha, salvo) => crypto.timingSafeEqual(Buffer.from(hash(senha, salvo.split(":")[0])), Buffer.from(salvo));

/* --- Token de sessão: dados em base64 + assinatura HMAC --- */
const assinatura = (b) => crypto.createHmac("sha256", SEGREDO).update(b).digest("base64url");
const sessao = (u) => {
  const b = Buffer.from(JSON.stringify({ email: u.email, perfil: u.perfil })).toString("base64url");
  return { nome: u.nome, email: u.email, perfil: u.perfil, token: b + "." + assinatura(b) };
};
function logado(req, res, next) {
  const [b, sig] = (req.get("authorization") || "").split(".");
  if (!b || !sig || sig.length !== 43 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(assinatura(b))))
    return res.status(401).json({ erro: "Faça login novamente." });
  req.usuario = JSON.parse(Buffer.from(b, "base64url"));
  next();
}
const admin = (req, res, next) => (req.usuario.perfil === "admin" ? next() : res.status(403).json({ erro: "Só administrador." }));

const app = express();
app.use(express.json({ limit: "2mb" })); // fotos vêm em base64
app.use(express.static("public"));

/* --- Usuários --- */
app.post("/api/login", async (req, res) => {
  const { rows: [u] } = await db.query("SELECT * FROM usuarios WHERE email = $1", [String(req.body.email)]);
  if (!u || !confere(req.body.senha, u.senha)) return res.status(401).json({ erro: "E-mail ou senha incorretos." });
  res.json(sessao(u));
});

app.post("/api/usuarios", async (req, res) => {
  const { nome, email, senha, doc, cep, whats, perfil, extras, aceitouTermos } = req.body;
  if (![nome, email, senha, doc, cep, whats].every((v) => typeof v === "string" && v.trim()))
    return res.status(400).json({ erro: "Preencha todos os dados fundamentais." });
  if (!["adotar", "doar", "instituicao"].includes(perfil)) return res.status(400).json({ erro: "Escolha um perfil." });
  if (aceitouTermos !== true) return res.status(400).json({ erro: "É preciso aceitar os termos de uso." });
  try {
    const { rows: [u] } = await db.query(
      `INSERT INTO usuarios (nome, email, senha, doc, cep, whats, perfil, extras, aceitou_termos_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING *`,
      [nome, email, hash(senha), doc, cep, whats, perfil, extras || {}]
    );
    res.status(201).json(sessao(u));
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ erro: "Este e-mail já está cadastrado." });
    throw e;
  }
});

app.get("/api/usuarios", logado, admin, async (req, res) => {
  const { rows } = await db.query("SELECT nome, email, perfil, whats, aceitou_termos_em FROM usuarios ORDER BY criado_em");
  res.json(rows);
});

// apaga o usuário e (por ON DELETE CASCADE) os pets dele; o admin não pode ser apagado
app.delete("/api/usuarios/:email", logado, admin, async (req, res) => {
  await db.query("DELETE FROM usuarios WHERE email = $1 AND perfil <> 'admin'", [req.params.email]);
  res.sendStatus(204);
});

/* --- Pets --- */
const PET = `id, nome, idade, peso::float AS peso, temperamento, sexo, vacinacao, situacao, especie,
             cidade, tutor, tutor_email AS "tutorEmail", foto, adotado`;

app.get("/api/pets", logado, async (req, res) => {
  res.json((await db.query(`SELECT ${PET} FROM pets ORDER BY id`)).rows);
});

app.get("/api/pets/:id", logado, async (req, res) => {
  const { rows: [p] } = await db.query(`SELECT ${PET} FROM pets WHERE id = $1`, [Number(req.params.id) || 0]);
  p ? res.json(p) : res.status(404).json({ erro: "Pet não encontrado." });
});

app.post("/api/pets", logado, async (req, res) => {
  const p = req.body;
  const textos = ["nome", "temperamento", "sexo", "vacinacao", "situacao", "especie", "cidade", "tutor"];
  if (textos.some((c) => typeof p[c] !== "string" || !p[c].trim()) || !(p.idade >= 0) || !(p.peso >= 0))
    return res.status(400).json({ erro: "Preencha todos os campos." });
  if (p.foto && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.foto))
    return res.status(400).json({ erro: "Foto inválida." });
  try {
    const { rows: [novo] } = await db.query(
      `INSERT INTO pets (nome, idade, peso, temperamento, sexo, vacinacao, situacao, especie, cidade, tutor, tutor_email, foto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [p.nome, Math.floor(p.idade), p.peso, p.temperamento, p.sexo, p.vacinacao, p.situacao, p.especie, p.cidade, p.tutor, req.usuario.email, p.foto || ""]
    );
    res.status(201).json(novo);
  } catch (e) {
    if (e.code === "23514") return res.status(400).json({ erro: "Dados do pet inválidos." });
    throw e;
  }
});

// adota: só se ainda não foi adotado e não é o próprio pet
app.post("/api/pets/:id/adotar", logado, async (req, res) => {
  const { rowCount } = await db.query(
    "UPDATE pets SET adotado = true WHERE id = $1 AND NOT adotado AND tutor_email IS DISTINCT FROM $2",
    [Number(req.params.id) || 0, req.usuario.email]
  );
  rowCount ? res.sendStatus(204) : res.status(409).json({ erro: "Este pet não pode ser adotado." });
});

app.delete("/api/pets/:id", logado, admin, async (req, res) => {
  await db.query("DELETE FROM pets WHERE id = $1", [Number(req.params.id) || 0]);
  res.sendStatus(204);
});

/* --- Relatório CSV (separador ";" e BOM para abrir certo no Excel em português) --- */
app.get("/api/relatorio.csv", logado, admin, async (req, res) => {
  const { rows } = await db.query(`
    SELECT p.id AS "Código", p.nome AS "Nome", p.especie AS "Espécie", p.sexo AS "Sexo", p.idade AS "Idade (anos)",
           p.peso AS "Peso (kg)", p.temperamento AS "Temperamento", p.vacinacao AS "Vacinação", p.situacao AS "Situação",
           p.cidade AS "Cidade", p.tutor AS "Tutor", COALESCE(p.tutor_email, '') AS "E-mail do tutor",
           CASE WHEN p.adotado THEN 'Adotado' ELSE 'Disponível' END AS "Status",
           to_char(p.criado_em, 'DD/MM/YYYY HH24:MI') AS "Cadastrado em"
    FROM pets p ORDER BY p.id`);
  // aspas em tudo; "'" na frente de =,+,-,@ evita fórmula maliciosa no Excel
  const cel = (v) => '"' + String(v ?? "").replace(/^[=+\-@]/, "'$&").replace(/"/g, '""') + '"';
  const colunas = rows.length ? Object.keys(rows[0]) : [];
  const csv = [colunas, ...rows.map(Object.values)].map((l) => l.map(cel).join(";")).join("\r\n");
  res.attachment("relatorio-pets.csv").type("text/csv; charset=utf-8").send("﻿" + csv);
});

/* --- Inicia: cria as tabelas, garante o admin e sobe o servidor --- */
(async () => {
  await db.query(fs.readFileSync(__dirname + "/schema.sql", "utf8"));
  await db.query(
    `INSERT INTO usuarios (nome, email, senha, perfil) VALUES ('Administrador', 'admin@petmatch.com', $1, 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [hash(process.env.ADMIN_SENHA || "admin123")]
  );
  const porta = process.env.PORT || 3000;
  app.listen(porta, () => console.log("PetMatch rodando em http://localhost:" + porta));
})();
