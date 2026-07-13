const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./axsystem.db", (err) => {

    if (err) {

        console.error("Erro ao conectar ao banco:", err.message);

    } else {

        console.log("Banco de dados conectado!");

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

                observacoes TEXT

            )
        `);

    }

});

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

module.exports = db;