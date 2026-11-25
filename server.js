/* =====================================================
   server.js - API do PetMatch + arquivos do site (pasta public/)
   Variáveis de ambiente: DATABASE_URL, SEGREDO, ADMIN_SENHA, PORT
   ===================================================== */
const express = require("express");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { formatar, docValido, cepValido, whatsValido } = require("./public/formatos.js"); // mesmas regras do navegador

try { process.loadEnvFile(); } catch {} // lê o .env se existir (rodar local)

const db = new Pool({ connectionString: process.env.DATABASE_URL });
db.on("error", (e) => console.error("Erro no banco:", e.message)); // conexão ociosa caiu: não derruba o servidor
// ponytail: sem SEGREDO fixo, todo mundo é deslogado quando o servidor reinicia
const SEGREDO = process.env.SEGREDO || crypto.randomBytes(32).toString("hex");
const VALIDADE_SESSAO = 7 * 24 * 60 * 60 * 1000; // 7 dias

/* --- Validações reutilizadas --- */
const texto = (v, max = 100) => typeof v === "string" && v.trim() !== "" && v.trim().length <= max;
const idDaUrl = (req) => (/^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : 0);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* --- Senhas (scrypt, da própria biblioteca do Node) --- */
const hash = (senha, sal = crypto.randomBytes(16).toString("hex")) =>
  sal + ":" + crypto.scryptSync(String(senha), sal, 64).toString("hex");
const confere = (senha, salvo) => crypto.timingSafeEqual(Buffer.from(hash(senha, salvo.split(":")[0])), Buffer.from(salvo));

/* --- Token de sessão: dados em base64 + assinatura HMAC --- */
const assinatura = (b) => crypto.createHmac("sha256", SEGREDO).update(b).digest("base64url");
const sessao = (u) => {
  const b = Buffer.from(JSON.stringify({ email: u.email, exp: Date.now() + VALIDADE_SESSAO })).toString("base64url");
  return { nome: u.nome, email: u.email, perfil: u.perfil, token: b + "." + assinatura(b) };
};
// confere o token e busca o usuário no banco (assim usuário apagado ou rebaixado perde o acesso na hora)
async function logado(req, res, next) {
  const [b, sig] = (req.get("authorization") || "").split(".");
  const negar = () => res.status(401).json({ erro: "Sua sessão expirou. Faça login novamente." });
  if (!b || !sig || sig.length !== 43 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(assinatura(b)))) return negar();
  const dados = JSON.parse(Buffer.from(b, "base64url"));
  if (!(dados.exp > Date.now())) return negar();
  const { rows: [u] } = await db.query("SELECT email, nome, perfil FROM usuarios WHERE email = $1", [dados.email]);
  if (!u) return negar();
  req.usuario = u;
  next();
}
const admin = (req, res, next) => (req.usuario.perfil === "admin" ? next() : res.status(403).json({ erro: "Só administrador." }));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" })); // fotos vêm em base64
app.use((req, res, next) => { req.body ??= {}; next(); }); // pedido sem corpo vira {}
app.use(express.static("public"));

app.get("/api/saude", async (req, res) => {
  await db.query("SELECT 1");
  res.json({ ok: true });
});

/* --- Usuários --- */
app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const { rows: [u] } = await db.query("SELECT * FROM usuarios WHERE lower(email) = lower($1)", [email]);
  if (!u || !confere(req.body.senha, u.senha)) return res.status(401).json({ erro: "E-mail ou senha incorretos." });
  res.json(sessao(u));
});

app.post("/api/usuarios", async (req, res) => {
  const { nome, senha, doc, cep, whats, perfil, extras = {}, aceitouTermos } = req.body;
  const email = String(req.body.email || "").trim().toLowerCase();
  if (![nome, doc, cep, whats].every((v) => texto(v))) return res.status(400).json({ erro: "Preencha todos os dados fundamentais." });
  if (!EMAIL.test(email) || email.length > 100) return res.status(400).json({ erro: "E-mail inválido." });
  if (typeof senha !== "string" || senha.length < 6 || senha.length > 100) return res.status(400).json({ erro: "A senha precisa ter pelo menos 6 caracteres." });
  if (!docValido(doc)) return res.status(400).json({ erro: "CPF/CNPJ inválido." });
  if (!cepValido(cep)) return res.status(400).json({ erro: "CEP inválido." });
  if (!whatsValido(whats)) return res.status(400).json({ erro: "WhatsApp inválido." });
  if (!["adotar", "doar", "instituicao"].includes(perfil)) return res.status(400).json({ erro: "Escolha um perfil." });
  const respostas = Object.entries(extras || {});
  if (typeof extras !== "object" || Array.isArray(extras) || respostas.length > 10 || !respostas.every(([, v]) => texto(v, 50)))
    return res.status(400).json({ erro: "Responda todas as perguntas do perfil." });
  if (aceitouTermos !== true) return res.status(400).json({ erro: "É preciso aceitar o Termo de Aceite e Condições de Uso." });
  try {
    const { rows: [u] } = await db.query(
      `INSERT INTO usuarios (nome, email, senha, doc, cep, whats, perfil, extras, aceitou_termos_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING *`,
      [nome.trim(), email, hash(senha), formatar(doc, "doc"), formatar(cep, "cep"), formatar(whats, "whats"), perfil, extras]
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
const OPCOES = {
  sexo: ["Macho", "Fêmea"],
  especie: ["Cachorro", "Gato"],
  vacinacao: ["Vacinado", "Não vacinado"],
  situacao: ["Castrado", "Não castrado"],
};
const FOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// devolve a mensagem de erro, ou "" se o pet está ok
function validarPet(p) {
  if (!["nome", "temperamento", "cidade", "tutor"].every((c) => texto(p[c], 60))) return "Preencha nome, temperamento, cidade e tutor (até 60 caracteres).";
  if (!Object.entries(OPCOES).every(([c, ops]) => ops.includes(p[c]))) return "Escolha sexo, espécie, vacinação e situação.";
  if (!Number.isInteger(p.idade) || p.idade < 0 || p.idade > 40) return "A idade deve ser um número inteiro de 0 a 40.";
  if (typeof p.peso !== "number" || !(p.peso >= 0.1 && p.peso <= 150)) return "O peso deve ficar entre 0,1 e 150 kg.";
  if (p.foto !== undefined && p.foto !== "" && !(typeof p.foto === "string" && FOTO.test(p.foto))) return "Foto inválida.";
  return "";
}
const camposPet = (p) => [
  p.nome.trim(), p.idade, Math.round(p.peso * 10) / 10, p.temperamento.trim(), p.sexo,
  p.vacinacao, p.situacao, p.especie, p.cidade.trim(), p.tutor.trim(), p.foto || "",
];

app.get("/api/pets", logado, async (req, res) => {
  res.json((await db.query(`SELECT ${PET} FROM pets ORDER BY id`)).rows);
});

app.get("/api/pets/:id", logado, async (req, res) => {
  const { rows: [p] } = await db.query(`SELECT ${PET} FROM pets WHERE id = $1`, [idDaUrl(req)]);
  p ? res.json(p) : res.status(404).json({ erro: "Pet não encontrado." });
});

app.post("/api/pets", logado, async (req, res) => {
  const erro = validarPet(req.body);
  if (erro) return res.status(400).json({ erro });
  const { rows: [novo] } = await db.query(
    `INSERT INTO pets (nome, idade, peso, temperamento, sexo, vacinacao, situacao, especie, cidade, tutor, foto, tutor_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [...camposPet(req.body), req.usuario.email]
  );
  res.status(201).json(novo);
});

// editar e excluir: só o dono do pet ou o admin
const doDono = "id = $1 AND (tutor_email = $2 OR $3)";
const donoParams = (req) => [idDaUrl(req), req.usuario.email, req.usuario.perfil === "admin"];

app.put("/api/pets/:id", logado, async (req, res) => {
  const erro = validarPet(req.body);
  if (erro) return res.status(400).json({ erro });
  const { rowCount } = await db.query(
    `UPDATE pets SET nome = $4, idade = $5, peso = $6, temperamento = $7, sexo = $8, vacinacao = $9,
       situacao = $10, especie = $11, cidade = $12, tutor = $13, foto = $14
     WHERE ${doDono}`,
    [...donoParams(req), ...camposPet(req.body)]
  );
  rowCount ? res.sendStatus(204) : res.status(404).json({ erro: "Pet não encontrado ou você não pode editá-lo." });
});

app.delete("/api/pets/:id", logado, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM pets WHERE ${doDono}`, donoParams(req));
  rowCount ? res.sendStatus(204) : res.status(404).json({ erro: "Pet não encontrado ou você não pode excluí-lo." });
});

// adota: só se ainda não foi adotado e não é o próprio pet
app.post("/api/pets/:id/adotar", logado, async (req, res) => {
  const { rowCount } = await db.query(
    "UPDATE pets SET adotado = true WHERE id = $1 AND NOT adotado AND tutor_email IS DISTINCT FROM $2",
    [idDaUrl(req), req.usuario.email]
  );
  rowCount ? res.sendStatus(204) : res.status(409).json({ erro: "Este pet não pode ser adotado." });
});

/* --- Relatórios CSV (separador ";" e BOM para abrir certo no Excel em português) --- */
function enviarCSV(res, nomeArquivo, rows, colunas = rows.length ? Object.keys(rows[0]) : []) {
  // aspas em tudo; "'" na frente de =,+,-,@ evita fórmula maliciosa no Excel
  const cel = (v) => '"' + String(v ?? "").replace(/^[=+\-@]/, "'$&").replace(/"/g, '""') + '"';
  const csv = [colunas, ...rows.map((r) => colunas.map((c) => r[c]))].map((l) => l.map(cel).join(";")).join("\r\n");
  res.attachment(nomeArquivo).type("text/csv; charset=utf-8").send("﻿" + csv);
}
const DATA_BR = (col) => `COALESCE(to_char(${col} AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), '')`;
const COLUNAS_PET = ["Código", "Nome", "Espécie", "Sexo", "Idade (anos)", "Faixa etária", "Peso (kg)", "Porte", "Temperamento",
  "Vacinação", "Situação", "Cidade", "Tutor", "E-mail do tutor", "Status", "Cadastrado em"];

// pets: admin vê todos; usuário comum escolhe "meus" (padrão) ou "disponiveis".
// Filtros iguais aos da home: especie, sexo, porte (p/m/g), idade (filhote/adulto/idoso), status (disponivel/adotado)
app.get("/api/relatorios/pets.csv", logado, async (req, res) => {
  const q = req.query, ehAdmin = req.usuario.perfil === "admin";
  const filtros = [], params = [];
  const com = (sql, valor) => { params.push(valor); filtros.push(sql.replace("?", "$" + params.length)); };
  if (q.escopo === "meus" || (!ehAdmin && q.escopo !== "disponiveis")) com("p.tutor_email = ?", req.usuario.email);
  if (q.escopo === "disponiveis" || q.status === "disponivel") filtros.push("NOT p.adotado");
  if (q.status === "adotado") filtros.push("p.adotado");
  if (OPCOES.especie.includes(q.especie)) com("p.especie = ?", q.especie);
  if (OPCOES.sexo.includes(q.sexo)) com("p.sexo = ?", q.sexo);
  const porte = { p: "p.peso <= 10", m: "p.peso > 10 AND p.peso <= 25", g: "p.peso > 25" }[q.porte];
  const idade = { filhote: "p.idade < 1", adulto: "p.idade BETWEEN 1 AND 7", idoso: "p.idade > 7" }[q.idade];
  if (porte) filtros.push(porte);
  if (idade) filtros.push(idade);

  const { rows } = await db.query(`
    SELECT p.id AS "Código", p.nome AS "Nome", p.especie AS "Espécie", p.sexo AS "Sexo", p.idade AS "Idade (anos)",
           CASE WHEN p.idade < 1 THEN 'Filhote' WHEN p.idade <= 7 THEN 'Adulto' ELSE 'Idoso' END AS "Faixa etária",
           replace(p.peso::text, '.', ',') AS "Peso (kg)",
           CASE WHEN p.peso <= 10 THEN 'Pequeno' WHEN p.peso <= 25 THEN 'Médio' ELSE 'Grande' END AS "Porte",
           p.temperamento AS "Temperamento", p.vacinacao AS "Vacinação", p.situacao AS "Situação",
           p.cidade AS "Cidade", p.tutor AS "Tutor", COALESCE(p.tutor_email, '') AS "E-mail do tutor",
           CASE WHEN p.adotado THEN 'Adotado' ELSE 'Disponível' END AS "Status", ${DATA_BR("p.criado_em")} AS "Cadastrado em"
    FROM pets p ${filtros.length ? "WHERE " + filtros.join(" AND ") : ""} ORDER BY p.id`, params);
  // e-mail dos tutores só aparece para o admin ou no relatório dos próprios pets
  const colunas = ehAdmin || q.escopo !== "disponiveis" ? COLUNAS_PET : COLUNAS_PET.filter((c) => c !== "E-mail do tutor");
  enviarCSV(res, "relatorio-pets.csv", rows, colunas);
});

// usuários com resumo dos pets de cada um (sem senha e sem CPF/CNPJ)
app.get("/api/relatorios/usuarios.csv", logado, admin, async (req, res) => {
  const { rows } = await db.query(`
    SELECT u.nome AS "Nome", u.email AS "E-mail",
           CASE u.perfil WHEN 'adotar' THEN 'Adotante' WHEN 'doar' THEN 'Doador'
                         WHEN 'instituicao' THEN 'Instituição' ELSE 'Administrador' END AS "Perfil",
           COALESCE(u.whats, '') AS "WhatsApp", COALESCE(u.cep, '') AS "CEP",
           COUNT(p.id) AS "Pets cadastrados", COUNT(p.id) FILTER (WHERE p.adotado) AS "Pets adotados",
           ${DATA_BR("u.aceitou_termos_em")} AS "Aceitou os termos em", ${DATA_BR("u.criado_em")} AS "Cadastrado em"
    FROM usuarios u LEFT JOIN pets p ON p.tutor_email = u.email
    GROUP BY u.email ORDER BY u.criado_em`);
  enviarCSV(res, "relatorio-usuarios.csv", rows);
});

/* --- Importar pets de um CSV (admin). Aceita o próprio relatório de pets ou o modelo.
       simular=true só confere e devolve o resultado de cada linha, sem gravar nada. --- */
const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COLUNAS_IMPORT = {
  codigo: "id", nome: "nome", especie: "especie", sexo: "sexo", idade: "idade", idadeanos: "idade", peso: "peso",
  pesokg: "peso", temperamento: "temperamento", vacinacao: "vacinacao", situacao: "situacao", cidade: "cidade",
  tutor: "tutor", emaildotutor: "tutorEmail", email: "tutorEmail", status: "status",
};
function petDaLinha(cabecalho, linha) {
  const p = {};
  cabecalho.forEach((c, i) => {
    const campo = COLUNAS_IMPORT[normalizar(c)];
    if (campo) p[campo] = String(linha[i] ?? "").trim();
  });
  // aceita "macho", "FEMEA", "nao vacinado"... e converte para o valor oficial
  for (const [c, ops] of Object.entries(OPCOES)) p[c] = ops.find((o) => normalizar(o) === normalizar(p[c])) ?? p[c];
  p.idade = /^\d+$/.test(p.idade) ? Number(p.idade) : NaN;
  p.peso = /^\d+([.,]\d+)?$/.test(p.peso) ? Number(p.peso.replace(",", ".")) : NaN;
  p.adotado = normalizar(p.status) === "adotado";
  return p;
}

app.post("/api/pets/importar", logado, admin, async (req, res) => {
  const { cabecalho, linhas, simular } = req.body;
  if (!Array.isArray(cabecalho) || !Array.isArray(linhas) || !linhas.every(Array.isArray))
    return res.status(400).json({ erro: "Arquivo CSV inválido." });
  if (!cabecalho.some((c) => COLUNAS_IMPORT[normalizar(c)] === "nome"))
    return res.status(400).json({ erro: 'Este arquivo não tem a coluna "Nome": não dá para importar pets dele. Use o modelo.' });
  if (linhas.length > 1000) return res.status(400).json({ erro: "Máximo de 1000 linhas por importação." });

  const ids = new Set((await db.query("SELECT id FROM pets")).rows.map((r) => r.id));
  const emails = new Map((await db.query("SELECT email FROM usuarios")).rows.map((r) => [r.email.toLowerCase(), r.email]));
  const resultado = linhas.map((l, i) => {
    if (l.every((c) => !String(c).trim())) return null; // linha vazia
    const p = petDaLinha(cabecalho, l);
    const base = { linha: i + 2, nome: p.nome || "" }; // +2: linha 1 é o cabeçalho
    if (ids.has(Number(p.id))) return { ...base, status: "ignorada", motivo: `Código #${p.id} já existe no banco` };
    const erro = validarPet(p);
    if (erro) return { ...base, status: "erro", motivo: erro };
    const tutorEmail = emails.get(String(p.tutorEmail || "").toLowerCase()) || null;
    return { ...base, status: "nova", motivo: tutorEmail ? "" : "Sem tutor cadastrado (fica como pet do site)", pet: { ...p, tutorEmail } };
  }).filter(Boolean);
  const novas = resultado.filter((r) => r.status === "nova");

  if (!simular && novas.length) {
    const cliente = await db.connect();
    try {
      await cliente.query("BEGIN"); // tudo ou nada
      for (const { pet } of novas)
        await cliente.query(
          `INSERT INTO pets (nome, idade, peso, temperamento, sexo, vacinacao, situacao, especie, cidade, tutor, foto, tutor_email, adotado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [...camposPet(pet), pet.tutorEmail, pet.adotado]
        );
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }
  res.json({ simulado: !!simular, novas: novas.length, linhas: resultado.map(({ pet, ...r }) => r) });
});

/* --- Erros: sempre respondem JSON, sem mostrar detalhes internos --- */
app.use("/api", (req, res) => res.status(404).json({ erro: "Rota não encontrada." }));
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ erro: "Os dados enviados são grandes demais (foto muito pesada?)." });
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ erro: "Requisição inválida." });
  console.error(err);
  res.status(500).json({ erro: "Erro no servidor. Tente novamente." });
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
})().catch((e) => {
  console.error("Não foi possível iniciar (o banco está acessível? DATABASE_URL certo?):", e.message);
  process.exit(1);
});
