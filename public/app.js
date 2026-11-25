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

/* --- Baixa um arquivo do servidor (com o token) e salva --- */
async function baixar(caminho, nomeArquivo) {
  const resp = await fetch("/api" + caminho, { headers: { Authorization: usuarioLogado().token } }).catch(() => null);
  if (!resp || !resp.ok) throw new Error("Não foi possível baixar o arquivo. Tente novamente.");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await resp.blob());
  link.download = nomeArquivo;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* --- Lê um arquivo escolhido pelo usuário como data URL (para enviar em JSON) --- */
function lerArquivo(arquivo) {
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(leitor.result);
    leitor.onerror = () => falha(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}
// confere o documento da parceria: PDF, JPG ou PNG de até 2 MB (devolve a mensagem de erro ou "")
const erroDocumento = (f) => (!/^(application\/pdf|image\/jpeg|image\/png)$/.test(f.type) ? "Envie um arquivo PDF, JPG ou PNG." : f.size > 2 * 1024 * 1024 ? "O arquivo passa de 2 MB." : "");

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
const dataBR = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-");

/* --- Cabeçalho: cada tela pede um "modo". Também coloca o rodapé e os avisos --- */
function montarCabecalho(modo) {
  desenharCabecalho(modo);
  document.getElementById("cabecalho").insertAdjacentHTML("afterend", '<div id="avisos"></div>');
  document.body.insertAdjacentHTML("beforeend",
    '<footer class="rodape"><a href="termos.html">Termo de Aceite e Condições de Uso</a> · <a href="contato.html">Contato e denúncias</a></footer>');
  if (modo === "logado" && usuarioLogado()) atualizarEu(modo);
}
function desenharCabecalho(modo) {
  const u = usuarioLogado();
  const eu = (u && u.eu) || {};
  const admin = u && u.perfil === "admin";
  let botoes = "";
  if (modo === "registro") botoes = '<a class="btn" href="index.html">FAZER LOGIN</a>';
  if (modo === "logado")
    botoes =
      (admin ? '<a class="btn" href="admin.html">ADMIN</a>' : "") +
      (eu.podeRegistrarPets ? '<a class="btn" href="registrar-animal.html">REGISTRAR PET</a>' : "") +
      (admin || eu.parceria ? '<a class="btn" href="meus-pets.html">MEUS PETS</a>' : "") +
      '<a class="btn" href="solicitacoes.html">SOLICITAÇÕES</a>' +
      '<a class="btn" href="perfil.html">MEUS DADOS</a>' +
      '<button class="btn" onclick="sair()">SAIR</button>';
  document.getElementById("cabecalho").innerHTML =
    '<header class="topo"><a class="logo" href="home.html"><img src="logo.jpeg" alt="PetMatch"></a><nav>' + botoes + "</nav></header>";
}
// busca os dados atualizados do usuário (permissões, e-mail confirmado, termo...) e avisa a página com o evento "eu"
async function atualizarEu(modo) {
  try {
    const eu = await api("GET", "/eu");
    const s = usuarioLogado();
    if (!s) return;
    localStorage.setItem("sessao", JSON.stringify({ ...s, nome: eu.nome, eu }));
    desenharCabecalho(modo);
    mostrarAvisos(eu);
    document.dispatchEvent(new CustomEvent("eu", { detail: eu }));
  } catch {}
}

/* --- Avisos no topo: confirmar e-mail, termo atualizado, documentação da parceria --- */
function mostrarAvisos(eu) {
  const avisos = [];
  const naPaginaDeDados = location.pathname.endsWith("perfil.html");
  if (!eu.termoAtualizado)
    avisos.push(`O Termo de Aceite e Condições de Uso foi atualizado. <a href="termos.html" target="_blank">Ler o termo</a>
      <button class="btn btn-pequeno" onclick="cienteTermo(this)">Estou ciente</button>`);
  if (!eu.emailVerificado)
    avisos.push(`Confirme seu e-mail (${esc(eu.email)}) para poder solicitar adoções.
      <button class="btn btn-pequeno" onclick="reenviarVerificacao(this)">Reenviar e-mail</button><span class="resultado-aviso"></span>`);
  if (eu.parceria === "sem_documento" && !naPaginaDeDados)
    avisos.push('Para cadastrar animais, envie a documentação da parceria em <a href="perfil.html">Meus dados</a>.');
  if (eu.parceria === "recusada" && !naPaginaDeDados)
    avisos.push('Seu pedido de parceria foi recusado. Veja o motivo e envie nova documentação em <a href="perfil.html">Meus dados</a>.');
  document.getElementById("avisos").innerHTML = avisos.map((a) => `<div class="aviso">${a}</div>`).join("");
}
async function cienteTermo(botao) {
  botao.disabled = true;
  await api("POST", "/eu/termo").catch(() => {});
  botao.closest(".aviso").remove();
}
async function reenviarVerificacao(botao) {
  const saida = botao.parentElement.querySelector(".resultado-aviso");
  botao.disabled = true;
  try {
    const r = await api("POST", "/eu/reenviar-verificacao");
    saida.innerHTML = r.linkVerificacao
      ? ` Modo de teste (servidor sem e-mail configurado): <a href="${esc(r.linkVerificacao)}">confirmar agora</a>`
      : " E-mail enviado! Veja sua caixa de entrada (e o spam).";
  } catch (e) {
    saida.textContent = " " + e.message;
    botao.disabled = false;
  }
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

/* --- Máscaras: <input data-mascara="doc|cep|whats|dinheiro"> formata enquanto digita (usa regras.js) ---
   Mantém o cursor no lugar certo mesmo editando no meio do texto. */
function ativarMascaras() {
  document.querySelectorAll("[data-mascara]").forEach((input) => {
    const tipo = input.dataset.mascara;
    input.inputMode = "numeric";
    if (PADROES[tipo]) input.maxLength = PADROES[tipo]("0".repeat(MAX_DIGITOS[tipo])).length;
    input.addEventListener("input", () => {
      const digitosAntes = input.value.slice(0, input.selectionStart).replace(/\D/g, "").length;
      input.value = formatar(input.value, tipo);
      let pos = 0;
      for (let n = 0; pos < input.value.length && n < digitosAntes; pos++) if (/\d/.test(input.value[pos])) n++;
      if (tipo === "dinheiro") pos = input.value.length; // dinheiro cresce da direita: cursor sempre no fim
      input.setSelectionRange(pos, pos);
    });
  });
}
