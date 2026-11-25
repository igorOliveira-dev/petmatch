# PetMatch

Site de adoção de animais: cadastro de usuários (adotante, doador, instituição), registro de pets,
adoção, painel do administrador, relatório CSV e termos de uso.

- **Front-end:** HTML, CSS e JavaScript puro (pasta `public/`)
- **Back-end:** Node.js + Express (`server.js`)
- **Banco de dados:** PostgreSQL (`schema.sql` — as tabelas são criadas automaticamente ao iniciar)

## Como executar no navegador

### Opção 1 — Docker (mais fácil)
```bash
docker compose up
```
Abra http://localhost:3000

### Opção 2 — Node + PostgreSQL instalados
```bash
cp .env.example .env   # e ajuste o DATABASE_URL
npm install
npm start
```
Abra http://localhost:3000

**Login de administrador:** `admin@petmatch.com` / `admin123` (troque com a variável `ADMIN_SENHA` antes do primeiro start).

## Funcionalidades pedidas

| Item | Onde |
|---|---|
| Site | `public/` |
| Banco de dados | `schema.sql` (tabelas `usuarios` e `pets`) |
| Relatórios em CSV | **Admin:** pets (filtro por status/espécie) e usuários. **Usuário comum:** "Meus pets" e, na Home, a lista de pets disponíveis com os filtros da tela |
| Exibir a importação do relatório | Painel Admin → **Importar pets (CSV)**: mostra o arquivo numa tabela com o resultado de cada linha e só grava depois de confirmar. Aceita o relatório de pets ou o `modelo-importacao-pets.csv` |
| Termo de uso aceito pelo usuário | Caixa "Li e aceito o Termo de Aceite e Condições de Uso" no cadastro; a data do aceite fica salva em `usuarios.aceitou_termos_em` |
| Link para exibir o termo | Rodapé de todas as páginas → `termos.html` |

## Regras do Termo de Aceite (o que o site garante)

| Item do termo | Como funciona |
|---|---|
| Confirmar e-mail | Link assinado enviado por e-mail (vale 3 dias); reenvio no aviso do topo |
| 18 anos para adotar | Data de nascimento no cadastro, conferida ao solicitar |
| Solicitação + questionário | Questionário de triagem obrigatório (`public/regras.js`) |
| Máximo de 3 em análise / cancelar | Conferido no servidor; botão cancelar em **Solicitações** |
| Entrevista obrigatória | Agendar → registrar parecer → só então **Aprovar** |
| Decisão da ONG/protetor | Só o responsável pelo pet decide; reprovar exige justificativa (o adotante vê) |
| Retorno em 7 dias | Dias sem retorno destacados para a ONG e para o admin |
| Contato do adotante só para a ONG | Aparece apenas nas solicitações recebidas pelo responsável |
| Homologação de parceiros | ONG/protetor envia documento; admin homologa ou recusa com motivo; só homologados cadastram pets |
| Taxas no perfil do animal | Campo "Taxa de castração/vacinação" |
| Canal de contato e denúncia | `contato.html` e link "Denunciar anúncio" em cada pet |
| Suspender/encerrar contas | Admin → Usuários |
| Consultar, corrigir, exportar, excluir dados | **Meus dados** (`perfil.html`) |
| Registro para auditoria | Tabela `auditoria`, visível no painel do admin |
| Notificações por e-mail | Confirmação, nova solicitação, cada mudança de status, parceria, suspensão |
| Aviso de alteração do termo | Mude `TERMO_VERSAO` em `server.js` ao editar `termos.html`: todos veem um aviso |
| Quem adotou | `pets.adotado_por` / `adotado_em`, gravados ao aprovar a solicitação |

## Outros recursos

- O dono do pet (ou o admin) pode **editar e excluir** o pet pela página dele
- CPF/CNPJ, CEP, WhatsApp e valores em R$ são formatados enquanto se digita e validados (inclusive dígitos verificadores) no navegador e no servidor — regras em `public/regras.js`, testes com `npm test`
- JS/CSS recebem `?v=` novo a cada deploy, então o cache do Cloudflare/navegador nunca mistura versões
- Saúde do servidor e do banco: `GET /api/saude` (pode ser usado como health check no Coolify)

## Deploy (Coolify)

1. Crie um banco PostgreSQL no Coolify e copie a URL de conexão interna.
2. No app do site, use o build pack **Nixpacks** (detecta o `package.json` e roda `npm start`), porta **3000**.
3. Variáveis de ambiente:
   - `DATABASE_URL` — URL do banco
   - `SEGREDO` — texto longo e aleatório (assina as sessões e os links de confirmação)
   - `ADMIN_SENHA` — senha do admin criada no primeiro start
   - `SITE_URL` — endereço público (ex.: `https://petmatch.bitemenu.com.br`), usado nos links dos e-mails
   - `SMTP_URL` e `EMAIL_REMETENTE` — servidor de e-mail. **Sem eles, nenhum e-mail é enviado** e o link de confirmação aparece na própria tela (modo de teste)
4. As tabelas novas são criadas/atualizadas sozinhas no start (o banco atual não perde dados).
