const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./axsystem.db", (err) => {
    if (err) {
        console.error("Erro ao conectar ao banco:", err.message);
    } else {
        console.log("Banco de dados conectado!");

        db.run(`
            CREATE TABLE IF NOT EXISTS clientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                cpf TEXT,
                telefone TEXT,
                email TEXT,
                cidade TEXT,
                observacao TEXT,
                status TEXT
            )
        `);

    }
});

module.exports = db;