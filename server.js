/* =====================================================
   server.js - API do PetMatch + arquivos do site (pasta public/)
   Variáveis de ambiente (veja .env.example):
     DATABASE_URL, SEGREDO, ADMIN_SENHA, PORT, SITE_URL, SMTP_URL, EMAIL_REMETENTE
   ===================================================== */
const express = require("express");
const { Pool, types } = require("pg");
const nodemailer = require("nodemailer");
const crypto = require("node:crypto");
const fs = require("node:fs");
const R = require("./public/regras.js"); // mesmas regras do navegador

try { process.loadEnvFile(); } catch {} // lê o .env se existir (rodar local)

types.setTypeParser(1082, (v) => v); // colunas DATE voltam como "AAAA-MM-DD" (sem fuso horário)
const db = new Pool({ connectionString: process.env.DATABASE_URL });
db.on("error", (e) => console.error("Erro no banco:", e.message)); // conexão ociosa caiu: não derruba o servidor
// ponytail: sem SEGREDO fixo, todo mundo é deslogado quando o servidor reinicia
const SEGREDO = process.env.SEGREDO || crypto.randomBytes(32).toString("hex");
const DIA = 24 * 60 * 60 * 1000;
const TERMO_VERSAO = "2026-11-24"; // mude a data ao alterar o termos.html: os usuários serão avisados

/* --- E-mail (notificações). Sem SMTP_URL, só mostra no console (modo de teste) --- */
const correio = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
function enviarEmail(para, assunto, texto) {
  if (!para) return;
  if (!correio) return console.log(`[e-mail NÃO enviado: falta SMTP_URL] Para: ${para} | ${assunto}\n${texto}\n`);
  correio
    .sendMail({ from: process.env.EMAIL_REMETENTE || "PetMatch <nao-responda@petmatch.com>", to: para, subject: assunto, text: texto + "\n\n— Equipe PetMatch" })
    .catch((e) => console.error("Falha ao enviar e-mail para", para, "-", e.message || e.code || e));
}
const urlSite = (req) => process.env.SITE_URL || req.protocol + "://" + req.get("host");
const dataHoraBR = (d) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/* --- Validações reutilizadas --- */
const texto = (v, max = 100, min = 1) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const idDaUrl = (req) => (/^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : 0);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOCUMENTO = /^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/;
const documentoValido = (d) => typeof d === "string" && d.length <= 2.8e6 && DOCUMENTO.test(d); // ~2 MB
const ehParceiro = (u) => ["doar", "instituicao"].includes(u.perfil);
const podeRegistrarPets = (u) => u.perfil === "admin" || (ehParceiro(u) && !!u.homologado_em);
const ATIVAS = "('em_analise', 'entrevista')";

/* --- Senhas (scrypt, da própria biblioteca do Node) --- */
const hash = (senha, sal = crypto.randomBytes(16).toString("hex")) =>
  sal + ":" + crypto.scryptSync(String(senha), sal, 64).toString("hex");
const confere = (senha, salvo) => crypto.timingSafeEqual(Buffer.from(hash(senha, salvo.split(":")[0])), Buffer.from(salvo));

/* --- Tokens assinados (sessão e confirmação de e-mail): dados em base64 + HMAC --- */
const assinatura = (b) => crypto.createHmac("sha256", SEGREDO).update(b).digest("base64url");
function criarToken(dados, validade) {
  const b = Buffer.from(JSON.stringify({ ...dados, exp: Date.now() + validade })).toString("base64url");
  return b + "." + assinatura(b);
}
function lerToken(token, tipo) {
  const [b, sig] = String(token || "").split(".");
  if (!b || !sig || sig.length !== 43 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(assinatura(b)))) return null;
  const d = JSON.parse(Buffer.from(b, "base64url"));
  return d.tipo === tipo && d.exp > Date.now() ? d : null;
}
const sessao = (u) => ({ nome: u.nome, email: u.email, perfil: u.perfil, token: criarToken({ tipo: "sessao", email: u.email }, 7 * DIA) });
const linkVerificacao = (req, email) => `${urlSite(req)}/api/verificar-email?token=${criarToken({ tipo: "verificar", email }, 3 * DIA)}`;
function enviarVerificacao(req, u) {
  const link = linkVerificacao(req, u.email);
  enviarEmail(u.email, "Confirme seu e-mail no PetMatch", `Olá, ${u.nome}!\n\nPara confirmar seu e-mail, abra o link abaixo (vale por 3 dias):\n${link}`);
  return correio ? undefined : link; // sem SMTP o link volta na resposta para dar para testar
}

/* --- Auditoria: registra operações sobre dados pessoais --- */
const auditar = (autor, acao, alvo = null, detalhes = {}) =>
  db.query("INSERT INTO auditoria (autor, acao, alvo, detalhes) VALUES ($1, $2, $3, $4)", [autor, acao, alvo, detalhes]);

/* --- Quem está logado: confere o token e busca o usuário no banco a cada pedido
       (usuário apagado, suspenso ou rebaixado perde o acesso na hora) --- */
async function carregarUsuario(req) {
  const t = lerToken(req.get("authorization"), "sessao");
  if (!t) return null;
  const { rows: [u] } = await db.query(
    "SELECT email, nome, perfil, nascimento, email_verificado_em, homologado_em, suspenso_em, whats FROM usuarios WHERE email = $1", [t.email]);
  return u && !u.suspenso_em ? u : null;
}
async function logado(req, res, next) {
  req.usuario = await carregarUsuario(req);
  req.usuario ? next() : res.status(401).json({ erro: "Sua sessão expirou ou a conta está suspensa. Faça login novamente." });
}
const admin = (req, res, next) => (req.usuario.perfil === "admin" ? next() : res.status(403).json({ erro: "Só administrador." }));

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // atrás do proxy do Coolify: req.protocol vira https
app.use(express.json({ limit: "4mb" })); // fotos e documentos vêm em base64
app.use((req, res, next) => { req.body ??= {}; next(); }); // pedido sem corpo vira {}

// Páginas HTML: carimba uma versão nova a cada deploy em todo .js/.css (app.js -> app.js?v=...).
// O Cloudflare guarda JS/CSS por horas; sem isso o navegador misturava HTML novo com JS velho e a página quebrava.
const VERSAO = Date.now().toString(36);
app.use((req, res, next) => {
  const arquivo = req.path === "/" ? "/index.html" : req.path;
  if (!/^\/[\w-]+\.html$/.test(arquivo)) return next(); // nome simples: sem risco de sair da pasta public/
  fs.readFile(__dirname + "/public" + arquivo, "utf8", (erro, html) => {
    if (erro) return next();
    res.set("Cache-Control", "no-cache").type("html").send(html.replace(/(src|href)="([\w-]+\.(?:js|css))"/g, `$1="$2?v=${VERSAO}"`));
  });
});
app.use(express.static("public"));

app.get("/api/saude", async (req, res) => {
  await db.query("SELECT 1");
  res.json({ ok: true });
});

/* =====================================================
   CADASTRO, LOGIN E CONFIRMAÇÃO DE E-MAIL
   ===================================================== */
// valida os dados pessoais (cadastro e "Meus dados"); devolve a mensagem de erro ou ""
function validarDadosPessoais({ nome, doc, cep, whats, nascimento }) {
  if (![nome, doc, cep, whats].every((v) => texto(v))) return "Preencha todos os dados fundamentais.";
  if (!R.docValido(doc)) return "CPF/CNPJ inválido.";
  if (!R.cepValido(cep)) return "CEP inválido.";
  if (!R.whatsValido(whats)) return "WhatsApp inválido.";
  if (!R.nascimentoValido(nascimento)) return "Data de nascimento inválida.";
  return "";
}

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const { rows: [u] } = await db.query("SELECT * FROM usuarios WHERE lower(email) = lower($1)", [email]);
  if (!u || !confere(req.body.senha, u.senha)) return res.status(401).json({ erro: "E-mail ou senha incorretos." });
  if (u.suspenso_em) return res.status(403).json({ erro: "Sua conta está suspensa. Fale conosco pela página de contato." });
  await auditar(u.email, "login", u.email);
  res.json(sessao(u));
});

app.post("/api/usuarios", async (req, res) => {
  const { nome, senha, doc, cep, whats, nascimento, perfil, extras = {}, aceitouTermos, documento, documentoNome } = req.body;
  const email = String(req.body.email || "").trim().toLowerCase();
  const erroDados = validarDadosPessoais(req.body);
  if (erroDados) return res.status(400).json({ erro: erroDados });
  if (!EMAIL.test(email) || email.length > 100) return res.status(400).json({ erro: "E-mail inválido." });
  if (typeof senha !== "string" || senha.length < 6 || senha.length > 100) return res.status(400).json({ erro: "A senha precisa ter pelo menos 6 caracteres." });
  if (!["adotar", "doar", "instituicao"].includes(perfil)) return res.status(400).json({ erro: "Escolha um perfil." });
  const respostas = Object.entries(extras || {});
  if (typeof extras !== "object" || Array.isArray(extras) || respostas.length > 10 || !respostas.every(([, v]) => texto(v, 50)))
    return res.status(400).json({ erro: "Responda todas as perguntas do perfil." });
  if (documento && (!["doar", "instituicao"].includes(perfil) || !documentoValido(documento) || !texto(documentoNome, 120)))
    return res.status(400).json({ erro: "Documento inválido: envie PDF, JPG ou PNG de até 2 MB." });
  if (aceitouTermos !== true) return res.status(400).json({ erro: "É preciso aceitar o Termo de Aceite e Condições de Uso." });
  try {
    const { rows: [u] } = await db.query(
      `INSERT INTO usuarios (nome, email, senha, doc, cep, whats, nascimento, perfil, extras, aceitou_termos_em, termo_versao, documento, documento_nome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, $12) RETURNING *`,
      [nome.trim(), email, hash(senha), R.formatar(doc, "doc"), R.formatar(cep, "cep"), R.formatar(whats, "whats"),
       nascimento, perfil, extras, TERMO_VERSAO, documento || null, documento ? documentoNome.trim() : null]
    );
    await auditar(email, "cadastro", email, { perfil, termo: TERMO_VERSAO, enviouDocumento: !!documento });
    res.status(201).json({ ...sessao(u), linkVerificacao: enviarVerificacao(req, u) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ erro: "Este e-mail já está cadastrado." });
    throw e;
  }
});

// link do e-mail de confirmação
app.get("/api/verificar-email", async (req, res) => {
  const t = lerToken(req.query.token, "verificar");
  if (!t) return res.redirect("/index.html?verificado=0");
  const { rowCount } = await db.query("UPDATE usuarios SET email_verificado_em = COALESCE(email_verificado_em, now()) WHERE email = $1", [t.email]);
  if (rowCount) await auditar(t.email, "confirmou o e-mail", t.email);
  res.redirect("/index.html?verificado=" + (rowCount ? 1 : 0));
});

app.post("/api/eu/reenviar-verificacao", logado, async (req, res) => {
  if (req.usuario.email_verificado_em) return res.status(409).json({ erro: "Seu e-mail já está confirmado." });
  res.json({ ok: true, linkVerificacao: enviarVerificacao(req, req.usuario) });
});

/* =====================================================
   MEUS DADOS (LGPD): consultar, corrigir, exportar e excluir
   ===================================================== */
function statusParceria(u) {
  if (!ehParceiro(u)) return null;
  if (u.homologado_em) return "homologada";
  if (u.parceria_recusa) return "recusada";
  return u.documento_nome ? "em_analise" : "sem_documento";
}

app.get("/api/eu", logado, async (req, res) => {
  const { rows: [u] } = await db.query("SELECT * FROM usuarios WHERE email = $1", [req.usuario.email]);
  res.json({
    nome: u.nome, email: u.email, perfil: u.perfil, doc: u.doc, cep: u.cep, whats: u.whats, nascimento: u.nascimento,
    extras: u.extras, criadoEm: u.criado_em, aceitouTermosEm: u.aceitou_termos_em,
    emailVerificado: !!u.email_verificado_em, parceria: statusParceria(u), parceriaRecusa: u.parceria_recusa,
    documentoNome: u.documento_nome, podeRegistrarPets: podeRegistrarPets(u),
    termoAtualizado: u.termo_versao === TERMO_VERSAO, termoVersao: TERMO_VERSAO,
  });
});

app.put("/api/eu", logado, async (req, res) => {
  const erro = validarDadosPessoais(req.body);
  if (erro) return res.status(400).json({ erro });
  const { nome, doc, cep, whats, nascimento } = req.body;
  await db.query("UPDATE usuarios SET nome = $2, doc = $3, cep = $4, whats = $5, nascimento = $6 WHERE email = $1",
    [req.usuario.email, nome.trim(), R.formatar(doc, "doc"), R.formatar(cep, "cep"), R.formatar(whats, "whats"), nascimento]);
  await auditar(req.usuario.email, "corrigiu os próprios dados", req.usuario.email);
  res.sendStatus(204);
});

app.post("/api/eu/senha", logado, async (req, res) => {
  const { atual, nova } = req.body;
  const { rows: [u] } = await db.query("SELECT senha FROM usuarios WHERE email = $1", [req.usuario.email]);
  if (!confere(atual, u.senha)) return res.status(400).json({ erro: "Senha atual incorreta." });
  if (typeof nova !== "string" || nova.length < 6 || nova.length > 100) return res.status(400).json({ erro: "A nova senha precisa ter pelo menos 6 caracteres." });
  await db.query("UPDATE usuarios SET senha = $2 WHERE email = $1", [req.usuario.email, hash(nova)]);
  await auditar(req.usuario.email, "alterou a senha", req.usuario.email);
  res.sendStatus(204);
});

// pedido de parceria: ONG/protetor envia (ou reenvia) a documentação
app.post("/api/eu/documento", logado, async (req, res) => {
  if (!ehParceiro(req.usuario)) return res.status(403).json({ erro: "Só perfis de doação ou instituição enviam documentação." });
  const { documento, documentoNome } = req.body;
  if (!documentoValido(documento) || !texto(documentoNome, 120)) return res.status(400).json({ erro: "Envie PDF, JPG ou PNG de até 2 MB." });
  await db.query("UPDATE usuarios SET documento = $2, documento_nome = $3, parceria_recusa = NULL WHERE email = $1",
    [req.usuario.email, documento, documentoNome.trim()]);
  await auditar(req.usuario.email, "enviou documentação de parceria", req.usuario.email, { arquivo: documentoNome });
  res.sendStatus(204);
});

app.post("/api/eu/termo", logado, async (req, res) => {
  await db.query("UPDATE usuarios SET termo_versao = $2, aceitou_termos_em = now() WHERE email = $1", [req.usuario.email, TERMO_VERSAO]);
  await auditar(req.usuario.email, "deu ciência da nova versão do termo", req.usuario.email, { termo: TERMO_VERSAO });
  res.sendStatus(204);
});

// exporta tudo o que o site guarda sobre o usuário, em JSON
app.get("/api/eu/exportar", logado, async (req, res) => {
  const e = req.usuario.email;
  const q = async (sql) => (await db.query(sql, [e])).rows;
  const [usuario] = await q(`SELECT nome, email, perfil, doc, cep, whats, nascimento, extras, criado_em, aceitou_termos_em, termo_versao,
    email_verificado_em, documento_nome, homologado_em, parceria_recusa FROM usuarios WHERE email = $1`);
  const dados = {
    exportadoEm: new Date().toISOString(),
    usuario,
    petsCadastrados: await q(`SELECT id, nome, especie, sexo, idade, peso, temperamento, vacinacao, situacao, cidade, tutor, taxa, adotado, adotado_em, criado_em
                              FROM pets WHERE tutor_email = $1 ORDER BY id`),
    petsAdotados: await q("SELECT id, nome, especie, adotado_em FROM pets WHERE adotado_por = $1"),
    solicitacoesDeAdocao: await q(`SELECT s.id, p.nome AS pet, s.status, s.respostas, s.entrevista_em, s.justificativa, s.criado_em, s.atualizado_em
                                   FROM solicitacoes s JOIN pets p ON p.id = s.pet_id WHERE s.adotante_email = $1 ORDER BY s.id`),
    mensagensEnviadas: await q("SELECT tipo, pet_id, mensagem, criado_em FROM mensagens WHERE usuario_email = $1"),
    registrosDeAuditoria: await q("SELECT quando, autor, acao, alvo, detalhes FROM auditoria WHERE autor = $1 OR alvo = $1 ORDER BY quando"),
  };
  await auditar(e, "exportou os próprios dados", e);
  res.attachment("meus-dados-petmatch.json").json(dados);
});

// exclui a própria conta (pede a senha). Pets e solicitações do usuário são apagados junto.
app.delete("/api/eu", logado, async (req, res) => {
  if (req.usuario.perfil === "admin") return res.status(403).json({ erro: "A conta de administrador não pode ser excluída." });
  const { rows: [u] } = await db.query("SELECT senha FROM usuarios WHERE email = $1", [req.usuario.email]);
  if (!confere(req.body.senha, u.senha)) return res.status(400).json({ erro: "Senha incorreta." });
  await db.query("DELETE FROM usuarios WHERE email = $1", [req.usuario.email]);
  await auditar(req.usuario.email, "excluiu a própria conta", req.usuario.email);
  res.sendStatus(204);
});

/* =====================================================
   ADMINISTRAÇÃO DE USUÁRIOS: listar, suspender, homologar parceiros
   ===================================================== */
app.get("/api/usuarios", logado, admin, async (req, res) => {
  const { rows } = await db.query(`SELECT nome, email, perfil, whats, aceitou_termos_em, email_verificado_em, suspenso_em,
    homologado_em, parceria_recusa, documento_nome FROM usuarios ORDER BY criado_em`);
  res.json(rows.map((u) => ({ ...u, parceria: statusParceria(u) })));
});

app.delete("/api/usuarios/:email", logado, admin, async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM usuarios WHERE email = $1 AND perfil <> 'admin'", [req.params.email]);
  if (rowCount) await auditar(req.usuario.email, "excluiu usuário", req.params.email);
  res.sendStatus(204);
});

app.post("/api/usuarios/:email/suspensao", logado, admin, async (req, res) => {
  const suspender = req.body.suspender === true;
  const { rows: [u] } = await db.query(
    "UPDATE usuarios SET suspenso_em = $2 WHERE email = $1 AND perfil <> 'admin' RETURNING nome, email",
    [req.params.email, suspender ? new Date() : null]);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });
  await auditar(req.usuario.email, suspender ? "suspendeu usuário" : "reativou usuário", u.email);
  enviarEmail(u.email, suspender ? "Sua conta no PetMatch foi suspensa" : "Sua conta no PetMatch foi reativada",
    suspender ? `Olá, ${u.nome}. Sua conta foi suspensa por descumprimento do Termo de Aceite e Condições de Uso. Fale conosco pela página de contato.`
              : `Olá, ${u.nome}. Sua conta foi reativada. Você já pode entrar novamente.`);
  res.sendStatus(204);
});

// homologar (aprovar) ou recusar o pedido de parceria de uma ONG/protetor
app.post("/api/usuarios/:email/parceria", logado, admin, async (req, res) => {
  const { aprovar, motivo } = req.body;
  if (!aprovar && !texto(motivo, 500, 5)) return res.status(400).json({ erro: "Informe o motivo da recusa." });
  const { rows: [u] } = await db.query(
    `UPDATE usuarios SET homologado_em = $2, parceria_recusa = $3
     WHERE email = $1 AND perfil IN ('doar', 'instituicao') AND documento IS NOT NULL RETURNING nome, email`,
    [req.params.email, aprovar ? new Date() : null, aprovar ? null : motivo.trim()]);
  if (!u) return res.status(404).json({ erro: "Pedido de parceria não encontrado (o usuário enviou a documentação?)." });
  await auditar(req.usuario.email, aprovar ? "homologou parceiro" : "recusou parceria", u.email, aprovar ? {} : { motivo });
  enviarEmail(u.email, aprovar ? "Parceria aprovada no PetMatch" : "Pedido de parceria recusado",
    aprovar ? `Olá, ${u.nome}! Sua parceria foi homologada. Você já pode cadastrar animais para adoção: ${urlSite(req)}/registrar-animal.html`
            : `Olá, ${u.nome}. Seu pedido de parceria foi recusado.\nMotivo: ${motivo}\nVocê pode enviar uma nova documentação em ${urlSite(req)}/perfil.html`);
  res.sendStatus(204);
});

app.get("/api/usuarios/:email/documento", logado, admin, async (req, res) => {
  const { rows: [u] } = await db.query("SELECT documento, documento_nome FROM usuarios WHERE email = $1", [req.params.email]);
  if (!u || !u.documento) return res.status(404).json({ erro: "Documento não encontrado." });
  const [, tipo, base64] = /^data:([^;]+);base64,(.*)$/.exec(u.documento);
  await auditar(req.usuario.email, "baixou documento de parceria", req.params.email);
  res.attachment(u.documento_nome).type(tipo).send(Buffer.from(base64, "base64"));
});

app.get("/api/auditoria", logado, admin, async (req, res) => {
  res.json((await db.query("SELECT quando, autor, acao, alvo, detalhes FROM auditoria ORDER BY quando DESC LIMIT 300")).rows);
});

/* =====================================================
   PETS
   ===================================================== */
const PET = `id, nome, idade, peso::float AS peso, temperamento, sexo, vacinacao, situacao, especie, cidade, tutor,
             tutor_email AS "tutorEmail", foto, adotado, adotado_em AS "adotadoEm", taxa::float AS taxa`;
const OPCOES = {
  sexo: ["Macho", "Fêmea"],
  especie: ["Cachorro", "Gato"],
  vacinacao: ["Vacinado", "Não vacinado"],
  situacao: ["Castrado", "Não castrado"],
};
const FOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
// responsável pelo pet: quem cadastrou; pets sem tutor (do site) ficam com o admin
const ehResponsavel = (u, pet) => pet.tutor_email === u.email || (pet.tutor_email == null && u.perfil === "admin");

// devolve a mensagem de erro, ou "" se o pet está ok
function validarPet(p) {
  if (!["nome", "temperamento", "cidade", "tutor"].every((c) => texto(p[c], 60))) return "Preencha nome, temperamento, cidade e tutor (até 60 caracteres).";
  if (!Object.entries(OPCOES).every(([c, ops]) => ops.includes(p[c]))) return "Escolha sexo, espécie, vacinação e situação.";
  if (!Number.isInteger(p.idade) || p.idade < 0 || p.idade > 40) return "A idade deve ser um número inteiro de 0 a 40.";
  if (typeof p.peso !== "number" || !(p.peso >= 0.1 && p.peso <= 150)) return "O peso deve ficar entre 0,1 e 150 kg.";
  if (p.taxa !== undefined && !(typeof p.taxa === "number" && p.taxa >= 0 && p.taxa <= 99999.99)) return "Taxa inválida.";
  if (p.foto !== undefined && p.foto !== "" && !(typeof p.foto === "string" && FOTO.test(p.foto))) return "Foto inválida.";
  return "";
}
const camposPet = (p) => [
  p.nome.trim(), p.idade, Math.round(p.peso * 10) / 10, p.temperamento.trim(), p.sexo,
  p.vacinacao, p.situacao, p.especie, p.cidade.trim(), p.tutor.trim(), p.foto || "", Math.round((p.taxa || 0) * 100) / 100,
];

app.get("/api/pets", logado, async (req, res) => {
  res.json((await db.query(`SELECT ${PET} FROM pets ORDER BY id`)).rows);
});

// detalhes; o responsável (e o admin) também vê quem adotou
app.get("/api/pets/:id", logado, async (req, res) => {
  const { rows: [p] } = await db.query(`SELECT ${PET}, adotado_por FROM pets WHERE id = $1`, [idDaUrl(req)]);
  if (!p) return res.status(404).json({ erro: "Pet não encontrado." });
  const { adotado_por, ...pet } = p;
  if (adotado_por && (ehResponsavel(req.usuario, { tutor_email: p.tutorEmail }) || req.usuario.perfil === "admin"))
    pet.adotante = (await db.query("SELECT nome, email, whats FROM usuarios WHERE email = $1", [adotado_por])).rows[0];
  res.json(pet);
});

app.post("/api/pets", logado, async (req, res) => {
  if (!podeRegistrarPets(req.usuario))
    return res.status(403).json({ erro: "Somente ONGs e protetores homologados podem cadastrar animais. Envie sua documentação em Meus dados." });
  const erro = validarPet(req.body);
  if (erro) return res.status(400).json({ erro });
  const { rows: [novo] } = await db.query(
    `INSERT INTO pets (nome, idade, peso, temperamento, sexo, vacinacao, situacao, especie, cidade, tutor, foto, taxa, tutor_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
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
       situacao = $10, especie = $11, cidade = $12, tutor = $13, foto = $14, taxa = $15
     WHERE ${doDono}`,
    [...donoParams(req), ...camposPet(req.body)]
  );
  rowCount ? res.sendStatus(204) : res.status(404).json({ erro: "Pet não encontrado ou você não pode editá-lo." });
});

app.delete("/api/pets/:id", logado, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM pets WHERE ${doDono}`, donoParams(req));
  rowCount ? res.sendStatus(204) : res.status(404).json({ erro: "Pet não encontrado ou você não pode excluí-lo." });
});

/* =====================================================
   SOLICITAÇÕES DE ADOÇÃO
   em_analise -> entrevista (agendada) -> parecer -> aprovada | reprovada ; o adotante pode cancelar
   ===================================================== */
app.post("/api/pets/:id/solicitacoes", logado, async (req, res) => {
  const u = req.usuario;
  if (!u.email_verificado_em) return res.status(403).json({ erro: "Confirme seu e-mail antes de solicitar uma adoção (veja Meus dados)." });
  const anos = R.idade(u.nascimento);
  if (anos === null) return res.status(403).json({ erro: "Informe sua data de nascimento em Meus dados para solicitar uma adoção." });
  if (anos < R.IDADE_MINIMA_ADOCAO) return res.status(403).json({ erro: `É preciso ter ${R.IDADE_MINIMA_ADOCAO} anos completos para solicitar uma adoção.` });
  const erro = R.validarQuestionario(req.body.respostas);
  if (erro) return res.status(400).json({ erro });

  const { rows: [pet] } = await db.query("SELECT id, nome, adotado, tutor_email FROM pets WHERE id = $1", [idDaUrl(req)]);
  if (!pet) return res.status(404).json({ erro: "Pet não encontrado." });
  if (pet.adotado) return res.status(409).json({ erro: "Este pet já foi adotado." });
  if (pet.tutor_email === u.email) return res.status(409).json({ erro: "Você não pode adotar o seu próprio pet." });
  // ponytail: contagem e insert separados; dois pedidos no mesmo instante poderiam passar de 3
  const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM solicitacoes WHERE adotante_email = $1 AND status IN ${ATIVAS}`, [u.email]);
  if (n >= R.MAX_SOLICITACOES_ATIVAS)
    return res.status(409).json({ erro: `Você já tem ${R.MAX_SOLICITACOES_ATIVAS} solicitações em análise. Aguarde ou cancele uma delas.` });

  const respostas = Object.fromEntries(R.QUESTIONARIO.map((q) => [q.id, req.body.respostas[q.id].trim()]));
  try {
    const { rows: [s] } = await db.query("INSERT INTO solicitacoes (pet_id, adotante_email, respostas) VALUES ($1, $2, $3) RETURNING id",
      [pet.id, u.email, respostas]);
    await auditar(u.email, "solicitou adoção", "pet #" + pet.id, { solicitacao: s.id });
    enviarEmail(pet.tutor_email, `Nova solicitação de adoção: ${pet.nome}`,
      `${u.nome} quer adotar ${pet.nome}.\nLembre-se: o primeiro retorno deve ser dado em até ${R.PRAZO_RETORNO_DIAS} dias.\nVeja a solicitação: ${urlSite(req)}/solicitacoes.html`);
    enviarEmail(u.email, `Solicitação enviada: ${pet.nome}`,
      `Recebemos sua solicitação para adotar ${pet.nome}. O responsável vai entrar em contato para agendar a entrevista. Acompanhe em ${urlSite(req)}/solicitacoes.html`);
    res.status(201).json(s);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ erro: "Você já tem uma solicitação em andamento para este pet." });
    throw e;
  }
});

// as que eu fiz (adotante): o parecer interno da entrevista não aparece, a justificativa sim
app.get("/api/solicitacoes/minhas", logado, async (req, res) => {
  const { rows } = await db.query(`
    SELECT s.id, s.pet_id AS "petId", p.nome AS pet, p.tutor, s.status, s.entrevista_em AS "entrevistaEm",
           s.justificativa, s.criado_em AS "criadoEm", s.atualizado_em AS "atualizadoEm"
    FROM solicitacoes s JOIN pets p ON p.id = s.pet_id
    WHERE s.adotante_email = $1 ORDER BY s.status IN ${ATIVAS} DESC, s.criado_em DESC`, [req.usuario.email]);
  res.json(rows);
});

// as recebidas pelos meus pets: aqui (e só aqui) aparecem os dados de contato do adotante
const SQL_RECEBIDAS = `
  SELECT s.id, s.pet_id AS "petId", p.nome AS pet, s.status, s.respostas, s.entrevista_em AS "entrevistaEm", s.parecer, s.justificativa,
         s.criado_em AS "criadoEm", s.primeiro_retorno_em AS "primeiroRetornoEm",
         a.nome AS "adotanteNome", a.email AS "adotanteEmail", a.whats AS "adotanteWhats", a.cep AS "adotanteCep",
         date_part('year', age(a.nascimento))::int AS "adotanteIdade",
         CASE WHEN s.primeiro_retorno_em IS NULL AND s.status IN ${ATIVAS}
              THEN floor(extract(epoch FROM now() - s.criado_em) / 86400)::int END AS "diasSemRetorno"
  FROM solicitacoes s JOIN pets p ON p.id = s.pet_id JOIN usuarios a ON a.email = s.adotante_email
  WHERE p.tutor_email = $1 OR (p.tutor_email IS NULL AND $2)
  ORDER BY s.status IN ${ATIVAS} DESC, s.criado_em`;
app.get("/api/solicitacoes/recebidas", logado, async (req, res) => {
  res.json((await db.query(SQL_RECEBIDAS, [req.usuario.email, req.usuario.perfil === "admin"])).rows);
});

// admin: solicitações que passaram do prazo de primeiro retorno (sem dados de contato)
app.get("/api/solicitacoes/atrasadas", logado, admin, async (req, res) => {
  const { rows } = await db.query(`
    SELECT s.id, p.id AS "petId", p.nome AS pet, p.tutor, COALESCE(p.tutor_email, '') AS "tutorEmail",
           floor(extract(epoch FROM now() - s.criado_em) / 86400)::int AS dias
    FROM solicitacoes s JOIN pets p ON p.id = s.pet_id
    WHERE s.primeiro_retorno_em IS NULL AND s.status IN ${ATIVAS} AND s.criado_em < now() - interval '${R.PRAZO_RETORNO_DIAS} days'
    ORDER BY s.criado_em`);
  res.json(rows);
});

app.post("/api/solicitacoes/:id/:acao", logado, async (req, res) => {
  const { acao } = req.params, u = req.usuario, b = req.body;
  const { rows: [s] } = await db.query(`
    SELECT s.*, p.nome AS pet_nome, p.tutor_email, p.tutor, a.nome AS adotante_nome
    FROM solicitacoes s JOIN pets p ON p.id = s.pet_id JOIN usuarios a ON a.email = s.adotante_email WHERE s.id = $1`, [idDaUrl(req)]);
  if (!s) return res.status(404).json({ erro: "Solicitação não encontrada." });
  if (!["em_analise", "entrevista"].includes(s.status)) return res.status(409).json({ erro: "Esta solicitação já foi finalizada." });
  const avisar = (assunto, msg) =>
    enviarEmail(s.adotante_email, `${assunto}: ${s.pet_nome}`, `Olá, ${s.adotante_nome}!\n\n${msg}\n\nAcompanhe em ${urlSite(req)}/solicitacoes.html`);
  const atualizar = (sets, params = []) =>
    db.query(`UPDATE solicitacoes SET ${sets}, atualizado_em = now() WHERE id = $1`, [s.id, ...params]);

  if (acao === "cancelar") {
    if (s.adotante_email !== u.email) return res.status(403).json({ erro: "Só quem fez a solicitação pode cancelá-la." });
    await atualizar("status = 'cancelada'");
    await auditar(u.email, "cancelou solicitação de adoção", "pet #" + s.pet_id, { solicitacao: s.id });
    enviarEmail(s.tutor_email, `Solicitação cancelada: ${s.pet_nome}`, `${s.adotante_nome} cancelou a solicitação de adoção de ${s.pet_nome}.`);
    return res.sendStatus(204);
  }

  // daqui para baixo: decisões que cabem só ao responsável pelo pet
  if (!ehResponsavel(u, s)) return res.status(403).json({ erro: "Só a ONG ou o protetor responsável pelo pet decide sobre a solicitação." });
  const log = (txt, det = {}) => auditar(u.email, txt, s.adotante_email, { solicitacao: s.id, pet: s.pet_id, ...det });

  if (acao === "agendar") {
    const quando = new Date(b.quando);
    if (isNaN(quando)) return res.status(400).json({ erro: "Informe a data e a hora da entrevista." });
    await atualizar("status = 'entrevista', entrevista_em = $2, primeiro_retorno_em = COALESCE(primeiro_retorno_em, now())", [quando]);
    await log("agendou entrevista");
    avisar("Entrevista agendada", `A entrevista para a adoção de ${s.pet_nome} foi marcada para ${dataHoraBR(quando)}. O responsável (${s.tutor}) vai falar com você pelo WhatsApp ou e-mail.`);
  } else if (acao === "parecer") {
    if (s.status !== "entrevista") return res.status(409).json({ erro: "Agende a entrevista antes de registrar o parecer." });
    if (!texto(b.parecer, 1000, 5)) return res.status(400).json({ erro: "Escreva o parecer da entrevista (5 a 1000 caracteres)." });
    await atualizar("parecer = $2", [b.parecer.trim()]);
    await log("registrou parecer da entrevista");
  } else if (acao === "reprovar") {
    if (!texto(b.justificativa, 1000, 5)) return res.status(400).json({ erro: "A justificativa é obrigatória para reprovar (5 a 1000 caracteres)." });
    await atualizar("status = 'reprovada', justificativa = $2, primeiro_retorno_em = COALESCE(primeiro_retorno_em, now())", [b.justificativa.trim()]);
    await log("reprovou solicitação");
    avisar("Solicitação reprovada", `Sua solicitação para adotar ${s.pet_nome} não foi aprovada.\nJustificativa: ${b.justificativa.trim()}`);
  } else if (acao === "aprovar") {
    if (s.status !== "entrevista" || !s.parecer) return res.status(409).json({ erro: "A entrevista é obrigatória: agende e registre o parecer antes de aprovar." });
    const cliente = await db.connect();
    let outros = [];
    try {
      await cliente.query("BEGIN");
      const { rowCount } = await cliente.query(
        "UPDATE pets SET adotado = true, adotado_por = $2, adotado_em = now() WHERE id = $1 AND NOT adotado", [s.pet_id, s.adotante_email]);
      if (!rowCount) { await cliente.query("ROLLBACK"); return res.status(409).json({ erro: "Este pet já foi adotado." }); }
      await cliente.query("UPDATE solicitacoes SET status = 'aprovada', atualizado_em = now() WHERE id = $1", [s.id]);
      // as outras solicitações ativas para o mesmo pet são encerradas, com justificativa
      ({ rows: outros } = await cliente.query(
        `UPDATE solicitacoes SET status = 'reprovada', justificativa = 'O animal foi adotado por outro candidato.',
           primeiro_retorno_em = COALESCE(primeiro_retorno_em, now()), atualizado_em = now()
         WHERE pet_id = $1 AND id <> $2 AND status IN ${ATIVAS} RETURNING adotante_email`, [s.pet_id, s.id]));
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
    await log("aprovou adoção", { outrasEncerradas: outros.length });
    const contato = s.tutor_email ? (await db.query("SELECT whats FROM usuarios WHERE email = $1", [s.tutor_email])).rows[0]?.whats : null;
    avisar("Adoção aprovada", `Parabéns! Sua adoção de ${s.pet_nome} foi aprovada. O responsável (${s.tutor}${contato ? ", WhatsApp " + contato : ""}) vai combinar a assinatura do termo de adoção e a entrega.`);
    for (const o of outros) enviarEmail(o.adotante_email, `Solicitação encerrada: ${s.pet_nome}`, `${s.pet_nome} foi adotado por outro candidato. Obrigado pelo interesse!`);
  } else {
    return res.status(404).json({ erro: "Ação desconhecida." });
  }
  res.sendStatus(204);
});

/* =====================================================
   CONTATO E DENÚNCIA
   ===================================================== */
app.post("/api/mensagens", async (req, res) => {
  const { tipo, nome, email, mensagem, site } = req.body;
  if (site) return res.status(201).json({ ok: true }); // campo invisível preenchido = robô de spam
  // ponytail: sem limite de envios por IP; adicione um se aparecer spam
  if (!["contato", "denuncia"].includes(tipo)) return res.status(400).json({ erro: "Escolha o tipo da mensagem." });
  if (!texto(nome, 100)) return res.status(400).json({ erro: "Informe seu nome." });
  if (!EMAIL.test(String(email || "").trim())) return res.status(400).json({ erro: "Informe um e-mail válido para resposta." });
  if (!texto(mensagem, 2000, 10)) return res.status(400).json({ erro: "Escreva a mensagem (10 a 2000 caracteres)." });
  const usuario = await carregarUsuario(req); // opcional: se estiver logado, guarda quem enviou
  const petId = Number(req.body.petId) || null;
  const existe = petId && (await db.query("SELECT 1 FROM pets WHERE id = $1", [petId])).rowCount;
  await db.query("INSERT INTO mensagens (tipo, nome, email, pet_id, mensagem, usuario_email) VALUES ($1, $2, $3, $4, $5, $6)",
    [tipo, nome.trim(), email.trim(), existe ? petId : null, mensagem.trim(), usuario?.email || null]);
  if (tipo === "denuncia") await auditar(usuario?.email || null, "enviou denúncia", existe ? "pet #" + petId : null);
  res.status(201).json({ ok: true });
});

app.get("/api/mensagens", logado, admin, async (req, res) => {
  const { rows } = await db.query(`SELECT m.id, m.tipo, m.nome, m.email, m.pet_id AS "petId", p.nome AS pet, m.mensagem,
    m.resolvida_em AS "resolvidaEm", m.criado_em AS "criadoEm" FROM mensagens m LEFT JOIN pets p ON p.id = m.pet_id
    ORDER BY m.resolvida_em IS NOT NULL, m.criado_em DESC LIMIT 300`);
  res.json(rows);
});

app.post("/api/mensagens/:id/resolver", logado, admin, async (req, res) => {
  await db.query("UPDATE mensagens SET resolvida_em = COALESCE(resolvida_em, now()) WHERE id = $1", [idDaUrl(req)]);
  res.sendStatus(204);
});

/* =====================================================
   RELATÓRIOS CSV (separador ";" e BOM para abrir certo no Excel em português)
   ===================================================== */
function enviarCSV(res, nomeArquivo, rows, colunas = rows.length ? Object.keys(rows[0]) : []) {
  // aspas em tudo; "'" na frente de =,+,-,@ evita fórmula maliciosa no Excel
  const cel = (v) => '"' + String(v ?? "").replace(/^[=+\-@]/, "'$&").replace(/"/g, '""') + '"';
  const csv = [colunas, ...rows.map((r) => colunas.map((c) => r[c]))].map((l) => l.map(cel).join(";")).join("\r\n");
  res.attachment(nomeArquivo).type("text/csv; charset=utf-8").send("﻿" + csv);
}
const DATA_BR = (col) => `COALESCE(to_char(${col} AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'), '')`;
const COLUNAS_PET = ["Código", "Nome", "Espécie", "Sexo", "Idade (anos)", "Faixa etária", "Peso (kg)", "Porte", "Temperamento",
  "Vacinação", "Situação", "Taxa (R$)", "Cidade", "Tutor", "E-mail do tutor", "Status", "Adotado por", "Adotado em", "Cadastrado em"];

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
           replace(p.taxa::text, '.', ',') AS "Taxa (R$)", p.cidade AS "Cidade", p.tutor AS "Tutor",
           COALESCE(p.tutor_email, '') AS "E-mail do tutor", CASE WHEN p.adotado THEN 'Adotado' ELSE 'Disponível' END AS "Status",
           COALESCE(a.nome, '') AS "Adotado por", ${DATA_BR("p.adotado_em")} AS "Adotado em", ${DATA_BR("p.criado_em")} AS "Cadastrado em"
    FROM pets p LEFT JOIN usuarios a ON a.email = p.adotado_por
    ${filtros.length ? "WHERE " + filtros.join(" AND ") : ""} ORDER BY p.id`, params);
  // e-mail do tutor e nome do adotante só para o admin ou no relatório dos próprios pets
  const privado = ["E-mail do tutor", "Adotado por"];
  const colunas = ehAdmin || q.escopo !== "disponiveis" ? COLUNAS_PET : COLUNAS_PET.filter((c) => !privado.includes(c));
  enviarCSV(res, "relatorio-pets.csv", rows, colunas);
});

// usuários com resumo dos pets de cada um (sem senha e sem CPF/CNPJ)
app.get("/api/relatorios/usuarios.csv", logado, admin, async (req, res) => {
  const { rows } = await db.query(`
    SELECT u.nome AS "Nome", u.email AS "E-mail",
           CASE u.perfil WHEN 'adotar' THEN 'Adotante' WHEN 'doar' THEN 'Protetor'
                         WHEN 'instituicao' THEN 'Instituição' ELSE 'Administrador' END AS "Perfil",
           COALESCE(u.whats, '') AS "WhatsApp", COALESCE(u.cep, '') AS "CEP",
           CASE WHEN u.email_verificado_em IS NOT NULL THEN 'Sim' ELSE 'Não' END AS "E-mail confirmado",
           CASE WHEN u.perfil NOT IN ('doar', 'instituicao') THEN '-' WHEN u.homologado_em IS NOT NULL THEN 'Homologada'
                WHEN u.parceria_recusa IS NOT NULL THEN 'Recusada' WHEN u.documento_nome IS NOT NULL THEN 'Em análise'
                ELSE 'Sem documentação' END AS "Parceria",
           CASE WHEN u.suspenso_em IS NOT NULL THEN 'Suspensa' ELSE 'Ativa' END AS "Conta",
           (SELECT count(*) FROM pets p WHERE p.tutor_email = u.email) AS "Pets cadastrados",
           (SELECT count(*) FROM pets p WHERE p.tutor_email = u.email AND p.adotado) AS "Pets doados",
           (SELECT count(*) FROM pets p WHERE p.adotado_por = u.email) AS "Pets adotados",
           (SELECT count(*) FROM solicitacoes s WHERE s.adotante_email = u.email) AS "Solicitações feitas",
           ${DATA_BR("u.aceitou_termos_em")} AS "Aceitou o termo em", ${DATA_BR("u.criado_em")} AS "Cadastrado em"
    FROM usuarios u ORDER BY u.criado_em`);
  await auditar(req.usuario.email, "baixou relatório de usuários");
  enviarCSV(res, "relatorio-usuarios.csv", rows);
});

// solicitações recebidas pelos pets do usuário (o admin recebe as dos pets do site)
const STATUS_BR = { em_analise: "Em análise", entrevista: "Entrevista agendada", aprovada: "Aprovada", reprovada: "Reprovada", cancelada: "Cancelada" };
app.get("/api/relatorios/solicitacoes.csv", logado, async (req, res) => {
  const { rows } = await db.query(SQL_RECEBIDAS, [req.usuario.email, req.usuario.perfil === "admin"]);
  const fmt = (d) => (d ? dataHoraBR(d) : "");
  enviarCSV(res, "solicitacoes-recebidas.csv", rows.map((s) => ({
    "Código": s.id, "Pet": s.pet, "Adotante": s.adotanteNome, "E-mail": s.adotanteEmail, "WhatsApp": s.adotanteWhats,
    "Idade": s.adotanteIdade ?? "", "Status": STATUS_BR[s.status], "Recebida em": fmt(s.criadoEm), "Primeiro retorno em": fmt(s.primeiroRetornoEm),
    "Dias sem retorno": s.diasSemRetorno ?? "", "Entrevista em": fmt(s.entrevistaEm), "Parecer": s.parecer || "", "Justificativa": s.justificativa || "",
    ...Object.fromEntries(R.QUESTIONARIO.map((q) => [q.pergunta, s.respostas[q.id] || ""])),
  })));
});

/* --- Importar pets de um CSV (admin). Aceita o próprio relatório de pets ou o modelo.
       simular=true só confere e devolve o resultado de cada linha, sem gravar nada. --- */
const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COLUNAS_IMPORT = {
  codigo: "id", nome: "nome", especie: "especie", sexo: "sexo", idade: "idade", idadeanos: "idade", peso: "peso",
  pesokg: "peso", temperamento: "temperamento", vacinacao: "vacinacao", situacao: "situacao", cidade: "cidade",
  tutor: "tutor", emaildotutor: "tutorEmail", email: "tutorEmail", status: "status", taxa: "taxa", taxars: "taxa",
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
  // taxa: "R$ 1.234,50", "50,00", "50" ou vazio (= sem taxa)
  const taxa = (p.taxa || "").replace(/[R$\s]/g, "");
  p.taxa = !taxa ? 0 : /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(taxa) ? Number(taxa.replace(/\./g, "").replace(",", ".")) : NaN;
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
          `INSERT INTO pets (nome, idade, peso, temperamento, sexo, vacinacao, situacao, especie, cidade, tutor, foto, taxa, tutor_email, adotado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [...camposPet(pet), pet.tutorEmail, pet.adotado]
        );
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
    await auditar(req.usuario.email, "importou pets por CSV", null, { quantidade: novas.length });
  }
  res.json({ simulado: !!simular, novas: novas.length, linhas: resultado.map(({ pet, ...r }) => r) });
});

/* --- Erros: sempre respondem JSON, sem mostrar detalhes internos --- */
app.use("/api", (req, res) => res.status(404).json({ erro: "Rota não encontrada." }));
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ erro: "Os dados enviados são grandes demais (arquivo muito pesado?)." });
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ erro: "Requisição inválida." });
  console.error(err);
  res.status(500).json({ erro: "Erro no servidor. Tente novamente." });
});

/* --- Inicia: cria/atualiza as tabelas, garante o admin e sobe o servidor --- */
(async () => {
  await db.query(fs.readFileSync(__dirname + "/schema.sql", "utf8"));
  await db.query(
    `INSERT INTO usuarios (nome, email, senha, perfil, termo_versao) VALUES ('Administrador', 'admin@petmatch.com', $1, 'admin', $2)
     ON CONFLICT (email) DO NOTHING`,
    [hash(process.env.ADMIN_SENHA || "admin123"), TERMO_VERSAO]
  );
  await db.query(`UPDATE usuarios SET email_verificado_em = COALESCE(email_verificado_em, now()),
    homologado_em = COALESCE(homologado_em, now()), termo_versao = COALESCE(termo_versao, $1) WHERE perfil = 'admin'`, [TERMO_VERSAO]);
  if (!correio) console.log("Aviso: SMTP_URL não configurado. E-mails serão só mostrados aqui no console.");
  const porta = process.env.PORT || 3000;
  app.listen(porta, () => console.log("PetMatch rodando em http://localhost:" + porta));
})().catch((e) => {
  console.error("Não foi possível iniciar (o banco está acessível? DATABASE_URL certo?):", e.message);
  process.exit(1);
});
