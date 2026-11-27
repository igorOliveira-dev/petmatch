# Banco de dados — PetMatch

PostgreSQL. As tabelas são criadas e atualizadas pelo [`schema.sql`](../schema.sql), que o servidor roda a cada vez que inicia.

Versão em imagem: [banco-de-dados.png](banco-de-dados.png).

## Diagrama entidade-relacionamento

```mermaid
erDiagram
    usuarios |o--o{ pets : "cadastra (tutor_email)"
    usuarios |o--o{ pets : "adota (adotado_por)"
    usuarios ||--o{ solicitacoes : "solicita (adotante_email)"
    pets ||--o{ solicitacoes : "recebe (pet_id)"
    usuarios |o--o{ mensagens : "envia (usuario_email)"
    pets |o--o{ mensagens : "é denunciado em (pet_id)"

    usuarios {
        TEXT email PK
        TEXT nome
        TEXT senha "hash scrypt sal:hash"
        TEXT doc "CPF ou CNPJ"
        TEXT cep
        TEXT whats
        DATE nascimento "18+ para adotar"
        TEXT perfil "adotar | doar | instituicao | admin"
        JSONB extras "perguntas do perfil"
        TIMESTAMPTZ email_verificado_em
        TEXT documento "parceria, base64"
        TEXT documento_nome
        TIMESTAMPTZ homologado_em "ONG/protetor aprovado"
        TEXT parceria_recusa "motivo da recusa"
        TIMESTAMPTZ suspenso_em
        TEXT termo_versao
        TIMESTAMPTZ aceitou_termos_em
        TIMESTAMPTZ criado_em
    }

    pets {
        SERIAL id PK
        TEXT nome
        INTEGER idade
        NUMERIC peso "kg"
        TEXT temperamento
        TEXT sexo "Macho | Fêmea"
        TEXT vacinacao
        TEXT situacao "castração"
        TEXT especie "Cachorro | Gato"
        TEXT cidade
        TEXT tutor "nome exibido"
        TEXT tutor_email FK "responsável; nulo = pet do site"
        TEXT foto "imagem base64"
        NUMERIC taxa "R$ castração/vacinação"
        BOOLEAN adotado
        TEXT adotado_por FK "quem adotou"
        TIMESTAMPTZ adotado_em
        TIMESTAMPTZ criado_em
    }

    solicitacoes {
        SERIAL id PK
        INTEGER pet_id FK
        TEXT adotante_email FK
        TEXT status "em_analise | entrevista | aprovada | reprovada | cancelada"
        JSONB respostas "questionário de triagem"
        TIMESTAMPTZ entrevista_em
        TEXT parecer "obrigatório para aprovar"
        TEXT justificativa "obrigatória para reprovar"
        TIMESTAMPTZ primeiro_retorno_em "prazo de 7 dias"
        TIMESTAMPTZ criado_em
        TIMESTAMPTZ atualizado_em
    }

    mensagens {
        SERIAL id PK
        TEXT tipo "contato | denuncia"
        TEXT nome
        TEXT email
        INTEGER pet_id FK "anúncio denunciado"
        TEXT mensagem
        TEXT usuario_email FK "se estava logado"
        TIMESTAMPTZ resolvida_em
        TIMESTAMPTZ criado_em
    }

    auditoria {
        SERIAL id PK
        TIMESTAMPTZ quando
        TEXT autor "e-mail; sem FK"
        TEXT acao
        TEXT alvo
        JSONB detalhes
    }
```

## Tabelas

| Tabela | Guarda | Observações |
|---|---|---|
| `usuarios` | Contas de adotantes, protetores, instituições e admin | Senha só como hash scrypt. Documento da parceria em base64, visível só para o admin |
| `pets` | Animais para adoção | `tutor_email` é o responsável (nulo = pet do site, cuidado pelo admin). `adotado_por`/`adotado_em` registram a adoção aprovada |
| `solicitacoes` | Pedidos de adoção | Um pedido ativo por adotante e pet (índice único parcial). No máximo 3 ativos por adotante, regra conferida no servidor |
| `mensagens` | Canal de contato e denúncia | Aceita envio sem login |
| `auditoria` | Operações sobre dados pessoais | Sem chave estrangeira: o registro fica mesmo se o usuário for excluído |

## O que acontece ao excluir

| Quando é excluído… | Efeito |
|---|---|
| um usuário | Os pets que ele cadastrou e as solicitações que fez são apagados; nos pets que adotou, `adotado_por` fica vazio; nas mensagens, `usuario_email` fica vazio |
| um pet | As solicitações dele são apagadas; nas mensagens, `pet_id` fica vazio |
