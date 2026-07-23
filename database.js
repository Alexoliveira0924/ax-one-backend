const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./axsystem.db", (err) => {

    if (err) {

        console.error("Erro ao conectar ao banco:", err.message);

    } else {

        console.log("Banco de dados conectado!");

        db.run("ALTER TABLE emprestimos ADD COLUMN emprestimo_origem_id INTEGER", (err) => {
    if (err && !err.message.includes("duplicate column")) console.log(err.message);
});

db.run("ALTER TABLE emprestimos ADD COLUMN emprestimo_filho_id INTEGER", (err) => {
    if (err && !err.message.includes("duplicate column")) console.log(err.message);
});

        // ==========================
        // TABELA CLIENTES
        // ==========================

        db.run(`
            CREATE TABLE IF NOT EXISTS clientes (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                codigo TEXT,

                nome TEXT NOT NULL,

                cpf TEXT,

                telefone TEXT,

                email TEXT,

                cidade TEXT,

                observacao TEXT,

                status TEXT

            )
        `);

        // ==========================
        // TABELA EMPRÉSTIMOS
        // ==========================

        db.run(`
CREATE TABLE IF NOT EXISTS emprestimos (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    contrato TEXT,

    cliente TEXT,

    valor REAL,

    juros REAL,

    parcelas INTEGER,

    dataEmprestimo TEXT,

    primeiroVencimento TEXT,

    observacoes TEXT,

    status TEXT DEFAULT 'Ativo',

    emprestimo_origem_id INTEGER,

    emprestimo_filho_id INTEGER

)
`);

// =========================
// TABELA PAGAMENTOS
// =========================

        db.run(`
CREATE TABLE IF NOT EXISTS pagamentos (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    emprestimo_id INTEGER NOT NULL,

    parcela INTEGER NOT NULL,

    vencimento TEXT,

    data_pagamento TEXT,

    valor REAL,

    status TEXT DEFAULT 'Pendente',

    observacoes TEXT,

    FOREIGN KEY (emprestimo_id) REFERENCES emprestimos(id)

)
`);

// ==============================
// TABELA RECEBIMENTOS DE PARCELAS
// ==============================

db.run(`
  CREATE TABLE IF NOT EXISTS recebimentos_parcelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    pagamento_id INTEGER NOT NULL,

    data_recebimento TEXT NOT NULL,

    valor_recebido REAL NOT NULL DEFAULT 0,

    juros REAL NOT NULL DEFAULT 0,

    multa REAL NOT NULL DEFAULT 0,

    desconto REAL NOT NULL DEFAULT 0,

    observacoes TEXT,

    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (pagamento_id) REFERENCES pagamentos(id)
  )

`);

// ==========================================
// GARANTIR CAMPO TIPO EM RECEBIMENTOS
// ==========================================

db.all(
  `PRAGMA table_info(recebimentos_parcelas)`,
  [],
  (erro, colunas) => {
    if (erro) {
      console.error(
        "Erro ao verificar tabela recebimentos_parcelas:",
        erro
      );
      return;
    }

    const possuiCampoTipo = colunas.some(
      (coluna) => coluna.name === "tipo"
    );

    if (!possuiCampoTipo) {
      db.run(
        `
          ALTER TABLE recebimentos_parcelas
          ADD COLUMN tipo TEXT NOT NULL DEFAULT 'Parcela'
        `,
        (erroAlteracao) => {
          if (erroAlteracao) {
            console.error(
              "Erro ao adicionar campo tipo:",
              erroAlteracao
            );
            return;
          }

          console.log(
            "Campo tipo adicionado em recebimentos_parcelas."
          );
        }
      );
    }
  }
);

// =========================
// TABELA RENEGOCIAÇÕES
// =========================

db.run(`
CREATE TABLE IF NOT EXISTS renegociacoes (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    emprestimo_origem INTEGER,

    emprestimo_novo INTEGER,

    data TEXT,

    saldo_devedor REAL,

    nova_taxa REAL,

    novas_parcelas INTEGER,

    observacao TEXT

)
`);

// =========================
// TABELA MOVIMENTAÇÕES
// =========================

db.run(`
CREATE TABLE IF NOT EXISTS movimentacoes (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    emprestimo_id INTEGER NOT NULL,

    data TEXT,

    hora TEXT,

    tipo TEXT,

    descricao TEXT,

    valor REAL,

    usuario TEXT,

    FOREIGN KEY (emprestimo_id)
        REFERENCES emprestimos(id)

)
`);

// ====================================
// TABELA EXTRATO DO CONTRATO
// ====================================

db.run(
    `
    CREATE TABLE IF NOT EXISTS extrato_contrato (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        emprestimo_id INTEGER NOT NULL,
        data TEXT NOT NULL,
        hora TEXT NOT NULL,
        tipo TEXT NOT NULL,
        descricao TEXT,
        valor REAL DEFAULT 0,
        saldo REAL DEFAULT 0,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (emprestimo_id)
            REFERENCES emprestimos(id)
    )
    `,
    err => {
        if (err) {
            console.error(
                "Erro ao criar tabela extrato_contrato:",
                err.message
            );
        } else {
            console.log(
                "Tabela extrato_contrato pronta!"
            );
        }
    }
);


    }   // fecha o else

});     // fecha new sqlite3.Database()

function adicionarExtrato(
    emprestimoId,
    tipo,
    descricao,
    valor = 0,
    saldo = 0
) {
    const agora = new Date();

    const data =
        agora.getFullYear() +
        "-" +
        String(agora.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(agora.getDate()).padStart(2, "0");

    const hora =
        String(agora.getHours()).padStart(2, "0") +
        ":" +
        String(agora.getMinutes()).padStart(2, "0") +
        ":" +
        String(agora.getSeconds()).padStart(2, "0");

    db.run(
        `
        INSERT INTO extrato_contrato
        (
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor,
            saldo
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
            emprestimoId,
            data,
            hora,
            tipo,
            descricao,
            Number(valor) || 0,
            Number(saldo) || 0
        ],
        function (err) {
            if (err) {
                console.error(
                    "Erro ao registrar extrato:",
                    err.message
                );
                return;
            }

            console.log(
                `Extrato registrado: ${tipo} - ${data} ${hora}`
            );
        }
    );
}


db.adicionarExtrato = adicionarExtrato;

module.exports = db;