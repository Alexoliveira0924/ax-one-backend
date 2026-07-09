const express = require("express");
const cors = require("cors");
const db = require("./database");

const app = express();

app.use(cors());
app.use(express.json());

// Teste do servidor
app.get("/", (req, res) => {
    res.send("Servidor AX SYSTEM funcionando!");
});

// Listar clientes
app.get("/clientes", (req, res) => {

    db.all("SELECT * FROM clientes", [], (err, rows) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json(rows);

    });

});

// Cadastrar cliente
app.post("/clientes", (req, res) => {

    const {
        nome,
        cpf,
        telefone,
        email,
        cidade,
        observacao,
        status
    } = req.body;

    db.run(
        `INSERT INTO clientes
        (nome, cpf, telefone, email, cidade, observacao, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            nome,
            cpf,
            telefone,
            email,
            cidade,
            observacao,
            status
        ],
        function (err) {

            if (err) {
                return res.status(500).json(err);
            }

            res.json({
                id: this.lastID,
                mensagem: "Cliente cadastrado com sucesso!"
            });

        }
    );

});

// =======================
// Atualizar cliente
// =======================

app.put("/clientes/:id", (req, res) => {

    const {
        nome,
        cpf,
        telefone,
        email,
        cidade,
        observacao,
        status
    } = req.body;

    db.run(
        `UPDATE clientes
        SET
            nome = ?,
            cpf = ?,
            telefone = ?,
            email = ?,
            cidade = ?,
            observacao = ?,
            status = ?
        WHERE id = ?`,
        [
            nome,
            cpf,
            telefone,
            email,
            cidade,
            observacao,
            status,
            req.params.id
        ],
        function (err) {

            if (err) {
                return res.status(500).json(err);
            }

            res.json({
                mensagem: "Cliente atualizado com sucesso!"
            });

        }
    );

});

// Excluir cliente
app.delete("/clientes/:id", (req, res) => {

    db.run(
        "DELETE FROM clientes WHERE id = ?",
        [req.params.id],
        function (err) {

            if (err) {
                return res.status(500).json(err);
            }

            res.json({
                mensagem: "Cliente excluído com sucesso!"
            });

        }
    );

});

app.listen(3001, () => {
    console.log("Servidor rodando na porta 3001");
});