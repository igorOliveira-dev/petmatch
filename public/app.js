/* =====================================================
   app.js - funções usadas por TODAS as telas
   Os dados ficam no banco PostgreSQL (via server.js).
   No navegador fica só a sessão (quem está logado).
   ===================================================== */

/* --- Conversa com o servidor --- */
async function api(metodo, caminho, corpo) {
  const sessao = usuarioLogado();
  const resp = await fetch("/api" + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: sessao ? sessao.token : "" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (resp.status === 401 && sessao) sair(); // token vencido: volta pro login
  if (resp.status === 204) return null;
  const dados = resp.headers.get("content-type")?.includes("json") ? await resp.json() : null;
  if (!resp.ok) throw new Error((dados && dados.erro) || "Erro no servidor.");
  return dados;
}

/* --- Sessão: quem está logado --- */
function usuarioLogado() {
  try { return JSON.parse(localStorage.getItem("sessao")); } catch { return null; }
}
function entrar(sessao) {
  localStorage.setItem("sessao", JSON.stringify(sessao));
  location.href = "home.html";
}
function exigirLogin() {
  // chame no topo das telas privadas
  if (!usuarioLogado()) location.href = "index.html";
}
function exigirAdmin() {
  // chame no topo das telas de administrador
  const u = usuarioLogado();
  if (!u || u.perfil !== "admin") location.href = "home.html";
}
function sair() {
  localStorage.removeItem("sessao");
  location.href = "index.html";
}

/* --- Evita que textos digitados por usuários virem HTML --- */
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* --- Cabeçalho: cada tela pede um "modo". Também coloca o rodapé com o link dos termos --- */
function montarCabecalho(modo) {
  let botoes = "";
  if (modo === "registro") botoes = '<a class="btn" href="index.html">FAZER LOGIN</a>';
  const admin = usuarioLogado() && usuarioLogado().perfil === "admin";
  if (modo === "logado")
    botoes =
      (admin ? '<a class="btn" href="admin.html">ADMIN</a>' : "") +
      '<a class="btn" href="registrar-animal.html">REGISTRAR PET</a>' +
      '<a class="btn" href="meus-pets.html">MEUS PETS</a>' +
      '<button class="btn" onclick="sair()">SAIR</button>';
  document.getElementById("cabecalho").innerHTML =
    '<header class="topo"><a class="logo" href="home.html"><img src="logo.jpeg" alt="PetMatch"></a><nav>' +
    botoes +
    "</nav></header>";
  document.body.insertAdjacentHTML("beforeend", '<footer class="rodape"><a href="termos.html">Termos de uso</a></footer>');
}

/* --- Grupos de botões de escolha (ex.: SIM / NÃO) --- */
function ativarOpcoes() {
  document.querySelectorAll(".opcoes").forEach((grupo) => {
    grupo.addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      grupo.querySelectorAll("button").forEach((b) => b.classList.remove("ativo"));
      e.target.classList.add("ativo");
    });
  });
}
// devolve as escolhas de um painel: { nomeDoGrupo: 'valor escolhido' }
function lerOpcoes(painel) {
  const r = {};
  painel.querySelectorAll(".opcoes").forEach((g) => {
    const ativo = g.querySelector(".ativo");
    r[g.dataset.nome] = ativo ? ativo.textContent : "";
  });
  return r;
}

/* --- Estilo de foto (usa a foto do pet ou uma patinha) --- */
function fotoStyle(pet) {
  return pet.foto ? `style="background-image:url('${esc(pet.foto)}')"` : "";
}

/* --- Cartão de pet (usado na home e em "meus pets") --- */
function cartaoPet(pet) {
  return `<a class="pet" href="animal.html?id=${pet.id}" ${fotoStyle(pet)}>${pet.foto ? "" : "🐾"}<span>${esc(pet.nome)}</span></a>`;
}
