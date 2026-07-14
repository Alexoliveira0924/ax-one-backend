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
        codigo,
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
        (codigo, nome, cpf, telefone, email, cidade, observacao, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            codigo,
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
        codigo,
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
            codigo = ?,
            nome = ?,
            cpf = ?,
            telefone = ?,
            email = ?,
            cidade = ?,
            observacao = ?,
            status = ?
        WHERE id = ?`,
        [
            codigo,
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

// =======================
// LISTAR EMPRÉSTIMOS
// =======================

app.get("/emprestimos", (req, res) => {

    db.all("SELECT * FROM emprestimos", [], (err, rows) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json(rows);

    });

});

// =======================
// PRÓXIMO CONTRATO
// =======================

app.get("/proximo-contrato", (req, res) => {

    db.get(
        `SELECT contrato
         FROM emprestimos
         ORDER BY id DESC
         LIMIT 1`,
        [],
        (err, row) => {

            if (err) {
                return res.status(500).json(err);
            }

            let numero = 1;

            if (row && row.contrato) {

                numero =
                    parseInt(row.contrato.split("-")[2]) + 1;

            }

            const contrato =
                `AX-2026-${numero.toString().padStart(6, "0")}`;

            res.json({
                contrato
            });

        }   // fecha o callback (err, row) => {

    );      // fecha o db.get

});         // fecha o app.get

// =======================
// CADASTRAR EMPRÉSTIMO
// =======================

app.post("/emprestimos", (req, res) => {

    const {
        contrato,
        cliente,
        valor,
        juros,
        parcelas,
        dataEmprestimo,
        primeiroVencimento,
        observacoes
    } = req.body;

    db.run(
        `INSERT INTO emprestimos
        (
            contrato,
            cliente,
            valor,
            juros,
            parcelas,
            dataEmprestimo,
            primeiroVencimento,
            observacoes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            contrato,
            cliente,
            valor,
            juros,
            parcelas,
            dataEmprestimo,
            primeiroVencimento,
            observacoes
        ],
        function(err){

            if(err){
                return res.status(500).json(err);
            }

            const emprestimoId = this.lastID;

            const primeiraData = new Date(primeiroVencimento);

            for(let i=1;i<=parcelas;i++){
                console.log("Gerando parcela", i);

                const vencimento = new Date(primeiraData);
                vencimento.setMonth(vencimento.getMonth() + (i-1));

                const dataFormatada =
                    vencimento.getFullYear() + "-" +
                    String(vencimento.getMonth()+1).padStart(2,"0") + "-" +
                    String(vencimento.getDate()).padStart(2,"0");

                db.run(
    `INSERT INTO pagamentos
    (
        emprestimo_id,
        parcela,
        vencimento,
        valor,
        status
    )
    VALUES (?,?,?,?,?)`,
    [
        emprestimoId,
        i,
        dataFormatada,
        valor / parcelas,
        "Pendente"
    ],
    function(err){

        if(err){
            console.log(err);
        }else{
            console.log("Parcela", i, "gravada");
        }

    }
);
}

            res.json({
    id: emprestimoId,
    mensagem: "Empréstimo cadastrado com sucesso!"
});

        }

    );

});

// ============================
// LISTAR PAGAMENTOS
// ============================

app.get("/pagamentos/:emprestimoId", (req, res) => {

    const { emprestimoId } = req.params;

    db.all(
        "SELECT * FROM pagamentos WHERE emprestimo_id = ? ORDER BY parcela",
        [emprestimoId],
        (err, rows) => {

            if (err) {
                return res.status(500).json(err);
            }

            res.json(rows);

        }
    );

});

app.get("/pagamentos", (req, res) => {

    db.all(
        "SELECT * FROM pagamentos",
        [],
        (err, rows) => {

            if (err) {
                return res.status(500).json(err);
            }

            res.json(rows);

        }
    );

});

// =======================
// ATUALIZAR EMPRÉSTIMO
// =======================

app.put("/emprestimos/:id", (req, res) => {

    const {
        contrato,
        cliente,
        valor,
        juros,
        parcelas,
        dataEmprestimo,
        primeiroVencimento,
        observacoes
    } = req.body;

    db.run(
        `UPDATE emprestimos
        SET
            contrato = ?,
            cliente = ?,
            valor = ?,
            juros = ?,
            parcelas = ?,
            dataEmprestimo = ?,
            primeiroVencimento = ?,
            observacoes = ?
        WHERE id = ?`,
        [
            contrato,
            cliente,
            valor,
            juros,
            parcelas,
            dataEmprestimo,
            primeiroVencimento,
            observacoes,
            req.params.id
        ],
        function (err) {

            if (err) {
                return res.status(500).json(err);
            }

            res.json({
                mensagem: "Empréstimo atualizado com sucesso!"
            });

        }
    );

});

// =======================
// EXCLUIR EMPRÉSTIMO
// =======================

app.delete("/emprestimos/:id", (req, res) => {

    const id = req.params.id;

    // Primeiro exclui as parcelas do empréstimo
    db.run(
        "DELETE FROM pagamentos WHERE emprestimo_id = ?",
        [id],
        function(err){

            if(err){
                return res.status(500).json(err);
            }

            // Depois exclui o empréstimo
            db.run(
                "DELETE FROM emprestimos WHERE id = ?",
                [id],
                function(err){

                    if(err){
                        return res.status(500).json(err);
                    }

                    res.json({
                        sucesso: true,
                        mensagem: "Empréstimo excluído com sucesso!"
                    });

                }
            );

        }
    );

});


// ============================
// CADASTRAR PAGAMENTO
// ============================

app.post("/pagamentos", (req, res) => {

    const {
        emprestimo_id,
        parcela,
        vencimento,
        valor
    } = req.body;

    db.run(
        `INSERT INTO pagamentos
        (emprestimo_id, parcela, vencimento, valor)
        VALUES (?,?,?,?)`,
        [
            emprestimo_id,
            parcela,
            vencimento,
            valor
        ],
        function(err){

            if(err){
                return res.status(500).json(err);
            }

            res.json({
                sucesso: true,
                id: this.lastID
            });

        }
    );

});

// ============================
// PAGAR PARCELA
// ============================

app.put("/pagamentos/:id", (req, res) => {

    const hoje = new Date().toISOString().split("T")[0];

    db.run(
        `UPDATE pagamentos
        SET
            status = 'Pago',
            data_pagamento = ?
        WHERE id = ?`,
        [
            hoje,
            req.params.id
        ],
        function(err){

            if(err){
                return res.status(500).json(err);
            }

            res.json({
                sucesso:true
            });

        }

    );

});

app.listen(3001, () => {
    console.log("Servidor rodando na porta 3001");
});