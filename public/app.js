/* =====================================================
   app.js - funções usadas por TODAS as telas
   Os dados ficam no banco PostgreSQL (via server.js).
   No navegador fica só a sessão (quem está logado).
   ===================================================== */

/* --- Conversa com o servidor --- */
async function api(metodo, caminho, corpo) {
  const sessao = usuarioLogado();
  let resp;
  try {
    resp = await fetch("/api" + caminho, {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: sessao ? sessao.token : "" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique sua internet e tente de novo.");
  }
  if (resp.status === 401 && sessao && caminho !== "/login") sair(); // sessão vencida: volta pro login
  if (resp.status === 204) return null;
  const dados = resp.headers.get("content-type")?.includes("json") ? await resp.json() : null;
  if (!resp.ok) throw new Error((dados && dados.erro) || "Erro no servidor.");
  return dados;
}

/* --- Baixa um relatório CSV do servidor (com o token) e salva como arquivo --- */
async function baixar(caminho, nomeArquivo) {
  const resp = await fetch("/api" + caminho, { headers: { Authorization: usuarioLogado().token } }).catch(() => null);
  if (!resp || !resp.ok) throw new Error("Não foi possível gerar o relatório. Tente novamente.");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await resp.blob());
  link.download = nomeArquivo;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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
      marcarOpcao(grupo, e.target.textContent);
    });
  });
}
// seleciona (por texto) um botão de um grupo de opções
function marcarOpcao(grupo, valor) {
  grupo.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("ativo", b.textContent === valor);
    b.setAttribute("aria-pressed", b.textContent === valor);
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
  return `<a class="pet" href="animal.html?id=${pet.id}" ${fotoStyle(pet)}>${pet.foto ? "" : "🐾"}<span>${esc(pet.nome)}${pet.adotado ? " · adotado" : ""}</span></a>`;
}

/* --- Máscaras: <input data-mascara="doc|cep|whats"> formata enquanto digita (usa formatos.js) ---
   Mantém o cursor no lugar certo mesmo editando no meio do texto. */
function ativarMascaras() {
  document.querySelectorAll("[data-mascara]").forEach((input) => {
    const tipo = input.dataset.mascara;
    input.inputMode = "numeric";
    input.maxLength = PADROES[tipo]("0".repeat(MAX_DIGITOS[tipo])).length;
    input.addEventListener("input", () => {
      const digitosAntes = input.value.slice(0, input.selectionStart).replace(/\D/g, "").length;
      input.value = formatar(input.value, tipo);
      let pos = 0;
      for (let n = 0; pos < input.value.length && n < digitosAntes; pos++) if (/\d/.test(input.value[pos])) n++;
      input.setSelectionRange(pos, pos);
    });
  });
}
