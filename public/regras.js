/* =====================================================
   regras.js - regras usadas no navegador E no servidor (server.js),
   assim os dois lados conferem tudo do mesmo jeito:
   máscaras, CPF/CNPJ, CEP, telefone, dinheiro, idade e questionário de triagem.
   ===================================================== */

// "0" = um dígito; o resto é copiado como está
const PADROES = {
  doc: (d) => (d.length <= 11 ? "000.000.000-00" : "00.000.000/0000-00"),
  cep: () => "00000-000",
  whats: (d) => (d.length <= 10 ? "(00) 0000-0000" : "(00) 00000-0000"),
};
const MAX_DIGITOS = { doc: 14, cep: 8, whats: 11, dinheiro: 7 };

// formatar("12345678909", "doc") -> "123.456.789-09";  formatar("5000", "dinheiro") -> "R$ 50,00"
function formatar(valor, tipo) {
  const d = String(valor ?? "").replace(/\D/g, "").slice(0, MAX_DIGITOS[tipo]);
  if (tipo === "dinheiro") return d ? "R$ " + (Number(d) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+,)/g, ".") : "";
  let r = "", i = 0;
  for (const c of PADROES[tipo](d)) {
    if (i >= d.length) break;
    r += c === "0" ? d[i++] : c;
  }
  return r;
}
// "R$ 1.234,50" -> 1234.5
const valorDinheiro = (v) => Number(String(v ?? "").replace(/\D/g, "") || 0) / 100;
const dinheiro = (n) => formatar(Math.round(Number(n) * 100), "dinheiro") || "R$ 0,00";

// confere os dígitos verificadores de CPF (11) ou CNPJ (14)
function docValido(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (pesos) => { const r = pesos.reduce((t, p, i) => t + d[i] * p, 0) % 11; return r < 2 ? 0 : 11 - r; };
  if (d.length === 11) return dv([10, 9, 8, 7, 6, 5, 4, 3, 2]) == d[9] && dv([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) == d[10];
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(p1) == d[12] && dv([6, ...p1]) == d[13];
}

const cepValido = (v) => /^\d{8}$/.test(String(v ?? "").replace(/\D/g, ""));
const whatsValido = (v) => /^[1-9]{2}9?\d{8}$/.test(String(v ?? "").replace(/\D/g, ""));

// idade em anos completos a partir de "AAAA-MM-DD" (null se a data for inválida)
function idade(nascimento, hoje = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(nascimento ?? ""));
  if (!m) return null;
  const [a, me, d] = [+m[1], +m[2], +m[3]];
  const data = new Date(Date.UTC(a, me - 1, d));
  if (data.getUTCMonth() !== me - 1 || data.getUTCDate() !== d) return null; // ex.: 31/02
  let anos = hoje.getFullYear() - a;
  if (hoje.getMonth() + 1 < me || (hoje.getMonth() + 1 === me && hoje.getDate() < d)) anos--;
  return anos;
}
const nascimentoValido = (v) => { const i = idade(v); return i !== null && i >= 0 && i <= 120; };
const IDADE_MINIMA_ADOCAO = 18;
const MAX_SOLICITACOES_ATIVAS = 3;
const PRAZO_RETORNO_DIAS = 7;

// Questionário de triagem da solicitação de adoção (todas obrigatórias)
const QUESTIONARIO = [
  { id: "residencia", pergunta: "Qual o tipo da sua residência?", opcoes: ["Casa", "Apartamento", "Chácara ou sítio"] },
  { id: "moradia", pergunta: "A residência é:", opcoes: ["Própria", "Alugada, e o proprietário permite animais", "Alugada, não sei se permite animais"] },
  { id: "seguranca", pergunta: "O local tem muros, telas ou portões que impedem fugas?", opcoes: ["Sim", "Não", "Vou providenciar"] },
  { id: "moradores", pergunta: "Todos os moradores concordam com a adoção?", opcoes: ["Sim", "Não", "Moro sozinho(a)"] },
  { id: "criancas", pergunta: "Há crianças na casa?", opcoes: ["Sim", "Não"] },
  { id: "outrosAnimais", pergunta: "Você tem outros animais?", opcoes: ["Sim, castrados e vacinados", "Sim, mas sem castração ou vacinas", "Não"] },
  { id: "tempoSozinho", pergunta: "Quanto tempo por dia o animal ficaria sozinho?", opcoes: ["Até 4 horas", "De 4 a 8 horas", "Mais de 8 horas"] },
  { id: "custos", pergunta: "Você pode arcar com alimentação, vacinas e veterinário?", opcoes: ["Sim", "Não"] },
  { id: "motivo", pergunta: "Por que você quer adotar este animal?", texto: true, min: 10, max: 500 },
];
// devolve a mensagem de erro, ou "" se todas as respostas estão certas
function validarQuestionario(respostas) {
  if (!respostas || typeof respostas !== "object") return "Responda o questionário de triagem.";
  for (const q of QUESTIONARIO) {
    const r = respostas[q.id];
    if (q.texto ? !(typeof r === "string" && r.trim().length >= q.min && r.trim().length <= q.max) : !q.opcoes.includes(r))
      return q.texto ? `"${q.pergunta}": escreva entre ${q.min} e ${q.max} caracteres.` : `Responda: "${q.pergunta}"`;
  }
  return "";
}

if (typeof module !== "undefined")
  module.exports = {
    formatar, valorDinheiro, dinheiro, docValido, cepValido, whatsValido, idade, nascimentoValido,
    IDADE_MINIMA_ADOCAO, MAX_SOLICITACOES_ATIVAS, PRAZO_RETORNO_DIAS, QUESTIONARIO, validarQuestionario,
  };
