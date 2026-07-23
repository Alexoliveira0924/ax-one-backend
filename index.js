const express = require("express");
const cors = require("cors");
const db = require("./database");

const app = express();

app.use(cors());
app.use(express.json());

// ====================================
// ATUALIZAÇÃO DA ESTRUTURA DO BANCO
// ====================================

db.run(
    `ALTER TABLE emprestimos
     ADD COLUMN saldo_devedor REAL`,
    err => {
        if (err && !err.message.includes("duplicate column name")) {
            console.error(
                "Erro ao criar coluna saldo_devedor:",
                err.message
            );
        }
    }
);

db.run(
    `UPDATE emprestimos
     SET saldo_devedor = valor
     WHERE saldo_devedor IS NULL`
);

// ====================================
// REGISTRAR MOVIMENTAÇÃO
// ====================================

function registrarMovimentacao(
    emprestimoId,
    tipo,
    descricao,
    valor = null
) {

    const agora = new Date();

    const data =
        agora.toISOString().split("T")[0];

    const hora =
        agora.toLocaleTimeString("pt-BR");

    db.run(
        `
        INSERT INTO movimentacoes
        (
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor
        )
        VALUES (?,?,?,?,?,?)
        `,
        [
            emprestimoId,
            data,
            hora,
            tipo,
            descricao,
            valor
        ]
    );

}

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

app.get("/emprestimos/historico/:contrato", (req, res) => {

    const contrato = req.params.contrato;

    db.all(

        `
        SELECT *
        FROM emprestimos
        WHERE contrato = ?
           OR contrato_origem = ?
        ORDER BY id
        `,

        [contrato, contrato],

        (erro, linhas) => {

            if (erro) {

                return res.status(500).json({
                    mensagem: erro.message
                });

            }

            res.json(linhas);

        }

    );

});

// ================================
// HISTÓRICO DO EMPRÉSTIMO
// ================================
app.get("/historico-emprestimo/:id", (req, res) => {
    const { id } = req.params;

    const historico = [];

    function buscarHistorico(idContrato) {
        db.get(
            `
            SELECT
                e.*,

                COALESCE(
                    (
                        SELECT SUM(p.valor)
                        FROM pagamentos p
                        WHERE p.emprestimo_id = e.id
                        AND p.status = 'Pendente'
                    ),
                    0
                ) AS valor_a_receber,

                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pagamentos p
                        WHERE p.emprestimo_id = e.id
                        AND p.status = 'Pendente'
                    ),
                    0
                ) AS parcelas_pendentes,

                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pagamentos p
                        WHERE p.emprestimo_id = e.id
                        AND p.status IN ('Pago', 'Recebido')
                    ),
                    0
                ) AS parcelas_pagas

            FROM emprestimos e
            WHERE e.id = ?
            `,
            [idContrato],
            (err, contrato) => {
                if (err) {
                    console.error(
                        "Erro ao buscar histórico:",
                        err.message
                    );

                    return res.status(500).json({
                        erro: "Erro ao buscar histórico do contrato."
                    });
                }

                if (!contrato) {
                    return res.json(historico);
                }

                historico.push(contrato);

                if (contrato.emprestimo_origem_id) {
                    buscarHistorico(
                        contrato.emprestimo_origem_id
                    );
                } else {
                    res.json(historico);
                }
            }
        );
    }

    buscarHistorico(id);
});

// ===================================
// LINHA DO TEMPO DO CONTRATO
// ===================================

app.get("/linha-tempo-contrato/:id", (req, res) => {
    const { id } = req.params;

    db.all(
        `
        SELECT
            id,
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor,
            NULL AS saldo,
            'movimentacoes' AS origem
        FROM movimentacoes
        WHERE emprestimo_id = ?

        UNION ALL

        SELECT
            id,
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor,
            saldo,
            'extrato_contrato' AS origem
        FROM extrato_contrato
        WHERE emprestimo_id = ?

        ORDER BY
            data ASC,
            hora ASC,
            id ASC
        `,
        [id, id],
        (erro, registros) => {
            if (erro) {
                console.error(
                    "Erro ao buscar linha do tempo:",
                    erro.message
                );

                return res.status(500).json({
                    erro: "Erro ao buscar a linha do tempo do contrato."
                });
            }

            res.json(registros || []);
        }
    );
});

// =======================
// LISTAR EMPRÉSTIMOS
// =======================

app.get("/emprestimos", (req, res) => {

    db.all(
        `
SELECT
    e.*,
    origem.contrato AS contrato_origem,

    MAX(
        0,

        COALESCE(
            (
                SELECT SUM(p.valor)
                FROM pagamentos p
                WHERE p.emprestimo_id = e.id
                AND p.status = 'Pendente'
            ),
            0
        )

        -

        COALESCE(
            (
                SELECT SUM(m.valor)
                FROM movimentacoes m
                WHERE m.emprestimo_id = e.id
                AND m.tipo = 'Amortização'
            ),
            0
        )
    ) AS valor_a_receber

FROM emprestimos e

LEFT JOIN emprestimos origem
    ON origem.id = e.emprestimo_origem_id

ORDER BY e.id DESC
`,
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


console.log("PASSOU DO SELECT");
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
            observacoes,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            contrato,
            cliente,
            valor,
            juros,
            parcelas,
            dataEmprestimo,
            primeiroVencimento,
            observacoes,
            "Ativo"
        ],
        function(err){

            if (err) {
    console.log("ERRO SQLITE:", err);
    return res.status(500).json({
        mensagem: err.message
    });
}

            const emprestimoId = this.lastID;

            registrarMovimentacao(
    emprestimoId,
    "Criação",
    `Contrato ${contrato} criado com ${parcelas} parcelas e juros de ${juros}%`,
    valor
);

            const primeiraData = new Date(primeiroVencimento);

            const valorTotal = Number(valor) + (Number(valor) * (Number(juros) / 100) * Number(parcelas));

            const valorParcela = valorTotal / Number(parcelas);

            for(let i=1;i<=parcelas;i++){
                console.log("Gerando parcela", i);

                const vencimento = new Date(primeiraData);
                vencimento.setMonth(vencimento.getMonth() + (i-1));

                const dataFormatada =
                    vencimento.getFullYear() + "-" +
                    String(vencimento.getMonth()+1).padStart(2,"0") + "-" +
                    String(vencimento.getDate()).padStart(2,"0");

                    console.log("Emprestimo ID:", emprestimoId);
                    console.log("Parcela:", i);
                    console.log("Valor:", valor / parcelas);
                    console.log("Data:", dataFormatada);

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
        valorParcela,
        "Pendente"
    ],
    function(err){

        if(err){
    console.log("ERRO AO INSERIR PARCELA:");
    console.log(err);
}else{
    console.log("Parcela", i, "gravada com sucesso!");
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
// LISTAR PAGAMENTOS DO EMPRÉSTIMO
// SEPARANDO PARCELA E JUROS
// ============================

app.get("/pagamentos/:emprestimoId", (req, res) => {
    const { emprestimoId } = req.params;

    db.all(
        `
        SELECT
            p.*,

            COALESCE(
                SUM(
                    CASE
                        WHEN r.tipo = 'Parcela'
                        THEN r.valor_recebido
                        ELSE 0
                    END
                ),
                0
            ) AS valor_recebido,

            COALESCE(
                SUM(
                    CASE
                        WHEN r.tipo = 'Juros'
                        THEN r.valor_recebido
                        ELSE 0
                    END
                ),
                0
            ) AS juros_recebidos,

            COALESCE(
                SUM(
                    CASE
                        WHEN r.tipo = 'Parcela'
                        THEN r.valor_recebido
                        ELSE 0
                    END
                ),
                0
            ) AS valor_aplicado,

            CASE
                WHEN
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido
                                ELSE 0
                            END
                        ),
                        0
                    ) >= p.valor - 0.009
                THEN 0

                ELSE
                    p.valor -
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido
                                ELSE 0
                            END
                        ),
                        0
                    )
            END AS saldo_restante,

            CASE
                WHEN
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido
                                ELSE 0
                            END
                        ),
                        0
                    ) >= p.valor - 0.009
                THEN 'Pago'

                WHEN
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido
                                ELSE 0
                            END
                        ),
                        0
                    ) > 0
                THEN 'Parcial'

                ELSE 'Pendente'
            END AS status_calculado

        FROM pagamentos p

        LEFT JOIN recebimentos_parcelas r
            ON r.pagamento_id = p.id

        WHERE p.emprestimo_id = ?

        GROUP BY p.id

        ORDER BY p.parcela
        `,
        [emprestimoId],
        (err, rows) => {
            if (err) {
                console.error(
                    "Erro ao listar pagamentos:",
                    err
                );

                return res.status(500).json({
                    erro: "Erro ao listar as parcelas."
                });
            }

            const pagamentosFormatados = rows.map(
                (pagamento) => ({
                    ...pagamento,

                    valor: Number(
                        pagamento.valor || 0
                    ),

                    valor_recebido: Number(
                        pagamento.valor_recebido || 0
                    ),

                    juros_recebidos: Number(
                        pagamento.juros_recebidos || 0
                    ),

                    valor_aplicado: Number(
                        pagamento.valor_aplicado || 0
                    ),

                    saldo_restante: Number(
                        pagamento.saldo_restante || 0
                    ),

                    status:
                        pagamento.status_calculado
                })
            );

            res.json(pagamentosFormatados);
        }
    );
});

// ==========================================
// HISTÓRICO DE RECEBIMENTOS DE UMA PARCELA
// ==========================================
app.get("/recebimentos-parcela/:pagamentoId", (req, res) => {
  const pagamentoId = Number(req.params.pagamentoId);

  if (!pagamentoId || pagamentoId <= 0) {
    return res.status(400).json({
      erro: "Parcela inválida.",
    });
  }

  db.get(
    `
      SELECT
        id,
        parcela,
        valor,
        vencimento,
        status
      FROM pagamentos
      WHERE id = ?
    `,
    [pagamentoId],
    (erroParcela, parcela) => {
      if (erroParcela) {
        console.error(
          "Erro ao consultar parcela:",
          erroParcela
        );

        return res.status(500).json({
          erro: "Erro ao consultar a parcela.",
        });
      }

      if (!parcela) {
        return res.status(404).json({
          erro: "Parcela não encontrada.",
        });
      }

      db.all(
        `
          SELECT
            id,
            pagamento_id,
            data_recebimento,
            valor_recebido,
            juros,
            multa,
            desconto,
            observacoes,
            criado_em
          FROM recebimentos_parcelas
          WHERE pagamento_id = ?
          ORDER BY
            data_recebimento ASC,
            id ASC
        `,
        [pagamentoId],
        (erroRecebimentos, recebimentos) => {
          if (erroRecebimentos) {
            console.error(
              "Erro ao consultar histórico de recebimentos:",
              erroRecebimentos
            );

            return res.status(500).json({
              erro:
                "Erro ao consultar o histórico da parcela.",
            });
          }

          const historico = recebimentos.map(
            (recebimento) => ({
              ...recebimento,

              valor_recebido: Number(
                recebimento.valor_recebido || 0
              ),

              juros: Number(
                recebimento.juros || 0
              ),

              multa: Number(
                recebimento.multa || 0
              ),

              desconto: Number(
                recebimento.desconto || 0
              ),
            })
          );

          const totalRecebido = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.valor_recebido,
            0
          );

          const totalJuros = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.juros,
            0
          );

          const totalMulta = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.multa,
            0
          );

          const totalDesconto = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.desconto,
            0
          );

          const totalAplicado = historico.reduce(
            (soma, recebimento) =>
              soma +
              recebimento.valor_recebido +
              recebimento.desconto -
              recebimento.juros -
              recebimento.multa,
            0
          );

          const valorOriginal = Number(
            parcela.valor || 0
          );

          const saldoRestante = Math.max(
            valorOriginal - totalAplicado,
            0
          );

          return res.json({
            parcela: {
              id: parcela.id,
              numero: parcela.parcela,
              valorOriginal,
              vencimento: parcela.vencimento,
              status:
                saldoRestante <= 0.009
                  ? "Pago"
                  : totalAplicado > 0
                  ? "Parcial"
                  : "Pendente",
            },

            resumo: {
              quantidadeRecebimentos:
                historico.length,

              totalRecebido,
              totalAplicado,
              totalJuros,
              totalMulta,
              totalDesconto,
              saldoRestante,
            },

            recebimentos: historico,
          });
        }
      );
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

// ==========================================
// RECEBER PARCELA OU SOMENTE JUROS
// ==========================================
app.put("/pagamentos/:id", (req, res) => {
  const parcelaId = Number(req.params.id);

  const {
  tipo = "Parcela",
  dataPagamento,
  valorRecebido,
  valorJuros,
  observacoes = "",
} = req.body;

const tipoRecebimento =
  tipo === "Juros" ? "Juros" : "Parcela";

const valorParcelaNumero = Number(
  valorRecebido || 0
);

const valorJurosNumero = Number(
  valorJuros || 0
);

const valorOperacao =
  tipoRecebimento === "Juros"
    ? valorJurosNumero
    : valorParcelaNumero;

  const dataPagamentoFinal =
    dataPagamento ||
    new Date().toISOString().split("T")[0];

  const toleranciaCentavos = 0.009;

  if (!parcelaId || parcelaId <= 0) {
    return res.status(400).json({
      erro: "Parcela inválida.",
    });
  }

  if (
  !Number.isFinite(valorOperacao) ||
  valorOperacao <= 0
) {
  return res.status(400).json({
    erro:
      tipoRecebimento === "Juros"
        ? "Informe o valor dos juros pago."
        : "Informe um valor recebido maior que zero.",
  });
}

  db.get(
    `
      SELECT
        id,
        emprestimo_id,
        parcela,
        valor,
        status
      FROM pagamentos
      WHERE id = ?
    `,
    [parcelaId],
    (erroParcela, parcela) => {
      if (erroParcela) {
        console.error(
          "Erro ao consultar parcela:",
          erroParcela
        );

        return res.status(500).json({
          erro: "Erro ao consultar a parcela.",
        });
      }

      if (!parcela) {
        return res.status(404).json({
          erro: "Parcela não encontrada.",
        });
      }

      db.get(
        `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN COALESCE(tipo, 'Parcela') = 'Parcela'
                  THEN valor_recebido + desconto
                  ELSE 0
                END
              ),
              0
            ) AS total_aplicado,

            COALESCE(
              SUM(
                CASE
                  WHEN COALESCE(tipo, 'Parcela') = 'Parcela'
                  THEN valor_recebido
                  ELSE 0
                END
              ),
              0
            ) AS total_recebido_parcela,

            COALESCE(
              SUM(
                CASE
                  WHEN tipo = 'Juros'
                  THEN valor_recebido
                  ELSE 0
                END
              ),
              0
            ) AS total_juros_recebidos

          FROM recebimentos_parcelas
          WHERE pagamento_id = ?
        `,
        [parcelaId],
        (erroTotais, totais) => {
          if (erroTotais) {
            console.error(
              "Erro ao consultar recebimentos:",
              erroTotais
            );

            return res.status(500).json({
              erro:
                "Erro ao calcular os recebimentos da parcela.",
            });
          }

          const valorOriginal = Number(
            parcela.valor || 0
          );

          const totalAplicadoAnterior = Number(
            totais.total_aplicado || 0
          );

          const saldoAntes = Math.max(
            valorOriginal - totalAplicadoAnterior,
            0
          );

          /*
            Somente juros:
            - registra receita adicional;
            - não reduz o saldo da parcela;
            - pode ser maior ou menor que o saldo.
          */
          if (tipoRecebimento === "Juros") {
            db.run(
              `
                INSERT INTO recebimentos_parcelas (
                  pagamento_id,
                  data_recebimento,
                  valor_recebido,
                  juros,
                  multa,
                  desconto,
                  observacoes,
                  tipo
                )
                VALUES (?, ?, ?, 0, 0, 0, ?, 'Juros')
              `,
              [
                parcelaId,
                dataPagamentoFinal,
                valorOperacao,
                observacoes,
              ],
              function (erroRecebimentoJuros) {
                if (erroRecebimentoJuros) {
                  console.error(
                    "Erro ao registrar juros:",
                    erroRecebimentoJuros
                  );

                  return res.status(500).json({
                    erro:
                      "Erro ao registrar o recebimento dos juros.",
                  });
                }

                registrarMovimentacao(
                  parcela.emprestimo_id,
                  "Recebimento de Juros",
                  `Juros referentes à parcela ${
                    parcela.parcela
                  } — R$ ${valorOperacao.toFixed(2)}`,
                  valorOperacao
                );

                return res.json({
                  sucesso: true,
                  mensagem:
                    "Recebimento de juros registrado com sucesso.",
                  tipo: "Juros",
                  recebimentoId: this.lastID,
                  parcelaId,
                  parcela: parcela.parcela,
                  dataPagamento: dataPagamentoFinal,
                  valorRecebido:
                    valorOperacao,
                  saldoParcela: saldoAntes,
                });
              }
            );

            return;
          }

          /*
            Pagamento de parcela:
            não pode ultrapassar o saldo restante.
          */
          if (
            valorOperacao >
            saldoAntes + toleranciaCentavos
          ) {
            return res.status(400).json({
              erro:
                "O valor informado é maior que o saldo da parcela.",

              mensagem:
                `O saldo atual da parcela é de R$ ${saldoAntes.toFixed(
                  2
                )}.`,

              saldoParcela: saldoAntes,
              valorInformado: valorParcelaNumero,
            });
          }

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            db.run(
              `
                INSERT INTO recebimentos_parcelas (
                  pagamento_id,
                  data_recebimento,
                  valor_recebido,
                  juros,
                  multa,
                  desconto,
                  observacoes,
                  tipo
                )
                VALUES (?, ?, ?, 0, 0, 0, ?, 'Parcela')
              `,
              [
    parcelaId,
    dataPagamentoFinal,
    valorParcelaNumero,
    observacoes,
],
              function (erroRecebimento) {
                if (erroRecebimento) {
                  console.error(
                    "Erro ao registrar parcela:",
                    erroRecebimento
                  );

                  db.run("ROLLBACK");

                  return res.status(500).json({
                    erro:
                      "Erro ao registrar o recebimento da parcela.",
                  });
                }

                const recebimentoId = this.lastID;

                const totalAplicado =
                  totalAplicadoAnterior +
                  valorParcelaNumero;

                const saldoRestante = Math.max(
                  valorOriginal - totalAplicado,
                  0
                );

                const novoStatus =
                  saldoRestante <= toleranciaCentavos
                    ? "Pago"
                    : "Parcial";

                db.run(
                  `
                    UPDATE pagamentos
                    SET
                      status = ?,
                      data_pagamento = ?,
                      observacoes = ?
                    WHERE id = ?
                  `,
                  [
                    novoStatus,
                    dataPagamentoFinal,
                    observacoes,
                    parcelaId,
                  ],
                  function (erroAtualizacao) {
                    if (erroAtualizacao) {
                      console.error(
                        "Erro ao atualizar parcela:",
                        erroAtualizacao
                      );

                      db.run("ROLLBACK");

                      return res.status(500).json({
                        erro:
                          "Erro ao atualizar a situação da parcela.",
                      });
                    }

                    registrarMovimentacao(
                      parcela.emprestimo_id,
                      novoStatus === "Pago"
                        ? "Recebimento de Parcela"
                        : "Recebimento Parcial",
                      `Parcela ${
                        parcela.parcela
                      } — recebimento de R$ ${valorParcelaNumero.toFixed(
                        2
                      )}`,
                      valorParcelaNumero
                    );

                    db.run(
                      "COMMIT",
                      (erroCommit) => {
                        if (erroCommit) {
                          console.error(
                            "Erro ao confirmar recebimento:",
                            erroCommit
                          );

                          db.run("ROLLBACK");

                          return res.status(500).json({
                            erro:
                              "Erro ao confirmar o recebimento.",
                          });
                        }

                        return res.json({
                          sucesso: true,

                          mensagem:
                            novoStatus === "Pago"
                              ? "Parcela quitada com sucesso."
                              : "Recebimento parcial registrado com sucesso.",

                          tipo: "Parcela",
                          recebimentoId,
                          parcelaId,
                          parcela: parcela.parcela,
                          dataPagamento:
                            dataPagamentoFinal,
                          valorOriginal,
                          saldoAntes,
                          valorRecebido:
                            valorParcelaNumero,
                          totalAplicado,
                          saldoRestante,
                          status: novoStatus,
                        });
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    }
  );
});

// ========================================
// RECEBER SOMENTE JUROS
// ========================================

app.post("/emprestimos/:id/receber-juros", (req, res) => {
    const emprestimoId = req.params.id;

    const {
        valorRecebido,
        jurosAdicional,
        multa,
        desconto,
        observacoes
    } = req.body;

    const agora = new Date();
    const data = agora.toISOString().split("T")[0];
    const hora = agora.toLocaleTimeString("pt-BR");

    const valorFinal =
        (Number(valorRecebido) || 0) +
        (Number(jurosAdicional) || 0) +
        (Number(multa) || 0) -
        (Number(desconto) || 0);

    const descricao =
        observacoes?.trim() ||
        "Recebimento somente dos juros do contrato";

    db.run(
        `
        INSERT INTO movimentacoes (
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            emprestimoId,
            data,
            hora,
            "Recebimento de Juros",
            descricao,
            valorFinal
        ],
        function (err) {
            if (err) {
                console.error(
                    "ERRO AO REGISTRAR RECEBIMENTO DE JUROS:",
                    err
                );

                return res.status(500).json({
                    erro: "Erro ao registrar o recebimento de juros."
                });
            }

            return res.json({
                sucesso: true,
                movimentacaoId: this.lastID,
                valorRecebido: valorFinal
            });
        }
    );
});

// ========================================
// AMORTIZAR SALDO DO EMPRÉSTIMO
// ========================================

app.post("/emprestimos/:id/amortizar", (req, res) => {

    const emprestimoId = req.params.id;

    const {
        valor,
        data_amortizacao,
        observacao
    } = req.body;

    const valorAmortizacao = Number(valor);

    if (
        !Number.isFinite(valorAmortizacao) ||
        valorAmortizacao <= 0
    ) {
        return res.status(400).json({
            erro: "Informe um valor de amortização válido."
        });
    }

    db.get(
        `
        SELECT *
        FROM emprestimos
        WHERE id = ?
        `,
        [emprestimoId],
        (erroBusca, emprestimo) => {

            if (erroBusca) {
                console.error(
                    "Erro ao buscar empréstimo:",
                    erroBusca
                );

                return res.status(500).json({
                    erro: "Erro ao localizar o empréstimo."
                });
            }

            if (!emprestimo) {
                return res.status(404).json({
                    erro: "Empréstimo não encontrado."
                });
            }

            const saldoAtual = Number(
                emprestimo.saldo_devedor ??
                emprestimo.valor ??
                0
            );

            if (valorAmortizacao > saldoAtual) {
                return res.status(400).json({
                    erro:
                        "O valor da amortização não pode ser maior que o saldo devedor."
                });
            }

            const novoSaldo =
                saldoAtual - valorAmortizacao;

            const data =
                data_amortizacao ||
                new Date().toISOString().split("T")[0];

            const hora =
                new Date().toLocaleTimeString("pt-BR");

            const descricao =
                observacao?.trim() ||
                `Amortização de saldo no valor de R$ ${valorAmortizacao.toFixed(2)}`;

            db.serialize(() => {

                db.run("BEGIN TRANSACTION");

                db.run(
                    `
                    UPDATE emprestimos
                    SET saldo_devedor = ?
                    WHERE id = ?
                    `,
                    [
                        novoSaldo,
                        emprestimoId
                    ],
                    function (erroAtualizacao) {

                        if (erroAtualizacao) {

                            db.run("ROLLBACK");

                            console.error(
                                "Erro ao atualizar saldo:",
                                erroAtualizacao
                            );

                            return res.status(500).json({
                                erro:
                                    "Erro ao atualizar o saldo devedor."
                            });
                        }

                        db.run(
                            `
                            INSERT INTO movimentacoes
                            (
                                emprestimo_id,
                                data,
                                hora,
                                tipo,
                                descricao,
                                valor
                            )
                            VALUES (?, ?, ?, ?, ?, ?)
                            `,
                            [
                                emprestimoId,
                                data,
                                hora,
                                "Amortização",
                                descricao,
                                valorAmortizacao
                            ],
                            function (erroMovimentacao) {

                                if (erroMovimentacao) {

                                    db.run("ROLLBACK");

                                    console.error(
                                        "Erro ao registrar amortização:",
                                        erroMovimentacao
                                    );

                                    return res.status(500).json({
                                        erro:
                                            "Erro ao registrar a movimentação."
                                    });
                                }

                                db.run(
                                    "COMMIT",
                                    erroCommit => {

                                        if (erroCommit) {

                                            db.run("ROLLBACK");

                                            return res.status(500).json({
                                                erro:
                                                    "Erro ao concluir a amortização."
                                            });
                                        }

                                        return res.json({
                                            sucesso: true,
                                            mensagem:
                                                "Amortização registrada com sucesso!",
                                            saldoAnterior: saldoAtual,
                                            valorAmortizado:
                                                valorAmortizacao,
                                            novoSaldo
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

// ========================================
// QUITAR CONTRATO
// ========================================

app.post("/emprestimos/:id/quitar", (req, res) => {

    const emprestimoId = req.params.id;

    const {
        data_quitacao,
        multa,
        desconto,
        observacao
    } = req.body;

    const valorMulta = Number(multa) || 0;
    const valorDesconto = Number(desconto) || 0;

    db.get(
        `
        SELECT
            e.*,

            COALESCE(
                (
                    SELECT SUM(p.valor)
                    FROM pagamentos p
                    WHERE p.emprestimo_id = e.id
                    AND p.status = 'Pendente'
                ),
                0
            )

            -

            COALESCE(
                (
                    SELECT SUM(m.valor)
                    FROM movimentacoes m
                    WHERE m.emprestimo_id = e.id
                    AND m.tipo = 'Amortização'
                ),
                0
            ) AS valor_a_receber

        FROM emprestimos e
        WHERE e.id = ?
        `,
        [emprestimoId],
        (erroBusca, emprestimo) => {

            if (erroBusca) {
                console.error(
                    "Erro ao buscar contrato:",
                    erroBusca
                );

                return res.status(500).json({
                    erro: "Erro ao localizar o contrato."
                });
            }

            if (!emprestimo) {
                return res.status(404).json({
                    erro: "Contrato não encontrado."
                });
            }

            if (emprestimo.status === "Quitado") {
                return res.status(400).json({
                    erro: "Este contrato já está quitado."
                });
            }

            if (emprestimo.status === "Renegociado") {
                return res.status(400).json({
                    erro:
                        "Um contrato renegociado não pode ser quitado diretamente."
                });
            }

            const saldoAtual = Math.max(
                Number(emprestimo.valor_a_receber || 0),
                0
            );

            if (saldoAtual <= 0) {
                return res.status(400).json({
                    erro:
                        "Este contrato não possui saldo pendente."
                });
            }

            if (
                valorDesconto >
                saldoAtual + valorMulta
            ) {
                return res.status(400).json({
                    erro:
                        "O desconto não pode ser maior que o valor da quitação."
                });
            }

            const valorRecebido =
                saldoAtual +
                valorMulta -
                valorDesconto;

            const data =
                data_quitacao ||
                new Date().toISOString().split("T")[0];

            const hora =
                new Date().toLocaleTimeString("pt-BR");

            const descricao =
                observacao?.trim() ||
                `Quitação total do contrato ${emprestimo.contrato}`;

            db.serialize(() => {

                db.run("BEGIN TRANSACTION");

                db.run(
                    `
                    UPDATE emprestimos
                    SET
                        status = 'Quitado',
                        saldo_devedor = 0
                    WHERE id = ?
                    `,
                    [emprestimoId],
                    function (erroContrato) {

                        if (erroContrato) {
                            db.run("ROLLBACK");

                            return res.status(500).json({
                                erro:
                                    "Erro ao atualizar o contrato."
                            });
                        }

                        db.run(
                            `
                            UPDATE pagamentos
                            SET status = 'Quitada'
                            WHERE emprestimo_id = ?
                            AND status = 'Pendente'
                            `,
                            [emprestimoId],
                            function (erroParcelas) {

                                if (erroParcelas) {
                                    db.run("ROLLBACK");

                                    return res.status(500).json({
                                        erro:
                                            "Erro ao baixar as parcelas."
                                    });
                                }

                                db.run(
                                    `
                                    INSERT INTO movimentacoes
                                    (
                                        emprestimo_id,
                                        data,
                                        hora,
                                        tipo,
                                        descricao,
                                        valor
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?)
                                    `,
                                    [
                                        emprestimoId,
                                        data,
                                        hora,
                                        "Quitação",
                                        descricao,
                                        valorRecebido
                                    ],
                                    function (erroMovimentacao) {

                                        if (erroMovimentacao) {
                                            db.run("ROLLBACK");

                                            return res.status(500).json({
                                                erro:
                                                    "Erro ao registrar a quitação."
                                            });
                                        }

                                        db.run(
                                            "COMMIT",
                                            erroCommit => {

                                                if (erroCommit) {
                                                    db.run("ROLLBACK");

                                                    return res
                                                        .status(500)
                                                        .json({
                                                            erro:
                                                                "Erro ao concluir a quitação."
                                                        });
                                                }

                                                return res.json({
                                                    sucesso: true,
                                                    mensagem:
                                                        "Contrato quitado com sucesso!",
                                                    saldoQuitado:
                                                        saldoAtual,
                                                    multa:
                                                        valorMulta,
                                                    desconto:
                                                        valorDesconto,
                                                    valorRecebido
                                                });
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

// ===================================
// RENEGOCIAR EMPRÉSTIMO
// ===================================

app.post("/renegociar", (req, res) => {

    console.log("ENTROU NA ROTA RENEGOCIAR");
console.log(req.body);

    const {
        emprestimo,
        saldoDevedor,
        novaTaxa,
        novasParcelas,
        observacao
    } = req.body;

    db.get(
        `SELECT contrato
         FROM emprestimos
         ORDER BY id DESC
         LIMIT 1`,
        [],
        (erro, ultimo) => {

            if (erro) {
                return res.status(500).json(erro);
            }

            let numero = 1;

            if (ultimo && ultimo.contrato) {

                numero =
                    parseInt(ultimo.contrato.split("-")[2]) + 1;

            }

            const novoContrato =
                `AX-2026-${numero.toString().padStart(6,"0")}`;

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
                    observacoes,
                    status,
                    emprestimo_origem_id
                )
                VALUES (?,?,?,?,?,?,?,?,?,?)`,

                [

                    novoContrato,
                    emprestimo.cliente,
                    emprestimo.valor,
                    novaTaxa,
                    novasParcelas,
                    new Date().toISOString().split("T")[0],
                    new Date().toISOString().split("T")[0],
                    observacao,
                    "Ativo",
                    emprestimo.id

                ],

                function(err){

    if (err){
        console.log("ERRO SQLITE:");
        console.log(err);
        return res.status(500).json(err);
    }

    console.log("INSERT DO EMPRESTIMO OK");

    const novoId = this.lastID;

    const saldoBase = Number(saldoDevedor) || 0;
    const taxaRenegociada = Number(novaTaxa) || 0;
    const quantidadeParcelas = Number(novasParcelas) || 0;

    const jurosTotalRenegociacao =
          saldoBase *
          (taxaRenegociada / 100) *
          quantidadeParcelas;

    const valorTotalRenegociado =
    saldoBase + jurosTotalRenegociacao;

                  db.run(
`UPDATE emprestimos
SET status = 'Renegociado',
emprestimo_filho_id = ?
WHERE id = ?`,
[novoId, emprestimo.id]
);

db.run(
    `UPDATE pagamentos
     SET status = 'Renegociada'
     WHERE emprestimo_id = ?
     AND status = 'Pendente'`,
    [emprestimo.id],
    function (err) {

        if (err) {
            console.log(err);
        }

        console.log("Parcelas alteradas:", this.changes);

    }
);

console.log("EMPRESTIMO CRIADO");

                    for (let i = 1; i <= novasParcelas; i++) {

    const amortizacao =
    saldoBase / quantidadeParcelas;

    const jurosMes =
    saldoBase * (taxaRenegociada / 100);

    const valorParcela = amortizacao + jurosMes;

    const vencimento = new Date();
    vencimento.setMonth(vencimento.getMonth() + (i - 1));

    db.run(
        `INSERT INTO pagamentos
        (emprestimo_id, parcela, valor, vencimento, status)
        VALUES (?, ?, ?, ?, ?)`,
        [
            novoId,
            i,
            valorParcela,
            vencimento.toISOString().split("T")[0],
            "Pendente"
        ]
    );

}

console.log("VAI ATUALIZAR O CONTRATO ANTIGO");

db.run(
"UPDATE emprestimos SET status = 'Renegociado' WHERE id = ?",
[emprestimo.id]
);

db.adicionarExtrato(
    emprestimo.id,
    "RENEGOCIAÇÃO",
    `Contrato ${emprestimo.contrato} renegociado e substituído pelo contrato ${novoContrato}.`,
    valorTotalRenegociado,
    0
);

db.adicionarExtrato(
    novoId,
    "RENEGOCIAÇÃO",
    `Novo contrato ${novoContrato} originado da renegociação do contrato ${emprestimo.contrato}.`,
    valorTotalRenegociado,
    valorTotalRenegociado
);

                    res.json({

                        sucesso:true,

                        contrato:novoContrato,

                        id:novoId

                    });

                }

            );

        }

    );

});

// ============================
// DASHBOARD EMPRÉSTIMOS
// ============================

app.get("/dashboard-emprestimos", (req, res) => {

    // 1. TOTAL ORIGINALMENTE EMPRESTADO
    db.get(
        `
        SELECT
            COALESCE(SUM(valor), 0) AS total_emprestado
        FROM emprestimos
        WHERE emprestimo_origem_id IS NULL
        `,
        [],
        (erroEmprestimos, resultadoEmprestimos) => {

            if (erroEmprestimos) {
                console.error(
                    "Erro ao calcular total emprestado:",
                    erroEmprestimos
                );

                return res.status(500).json({
                    erro:
                        "Erro ao calcular o total emprestado."
                });
            }

            /*
                2. TOTAL RECEBIDO

                Soma:
                - pagamentos de parcelas;
                - pagamentos somente de juros.

                Os juros também são dinheiro recebido,
                mas não reduzem o saldo da parcela.
            */
            db.get(
                `
                SELECT
                    COALESCE(
                        SUM(r.valor_recebido),
                        0
                    ) AS total_recebido,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN COALESCE(
                                    r.tipo,
                                    'Parcela'
                                ) = 'Parcela'
                                THEN
                                    r.valor_recebido
                                    + COALESCE(r.desconto, 0)

                                ELSE 0
                            END
                        ),
                        0
                    ) AS total_aplicado_parcelas,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Juros'
                                THEN r.valor_recebido
                                ELSE 0
                            END
                        ),
                        0
                    ) AS total_juros_recebidos

                FROM recebimentos_parcelas r

                INNER JOIN pagamentos p
                    ON p.id = r.pagamento_id

                INNER JOIN emprestimos e
                    ON e.id = p.emprestimo_id

                WHERE e.status = 'Ativo'
                `,
                [],
                (
                    erroRecebimentos,
                    resultadoRecebimentos
                ) => {

                    if (erroRecebimentos) {
                        console.error(
                            "Erro ao calcular recebimentos:",
                            erroRecebimentos
                        );

                        return res.status(500).json({
                            erro:
                                "Erro ao calcular os recebimentos."
                        });
                    }

                    /*
                        3. TOTAL A RECEBER

                        Somente pagamentos do tipo Parcela
                        reduzem o saldo.

                        Pagamentos do tipo Juros não reduzem
                        o valor das parcelas.
                    */
                    db.get(
                        `
                        SELECT
                            COALESCE(
                                SUM(
                                    CASE
                                        WHEN
                                            p.valor -
                                            COALESCE(
                                                recebido.total_aplicado,
                                                0
                                            ) > 0

                                        THEN
                                            p.valor -
                                            COALESCE(
                                                recebido.total_aplicado,
                                                0
                                            )

                                        ELSE 0
                                    END
                                ),
                                0
                            ) AS total_receber_parcelas

                        FROM pagamentos p

                        INNER JOIN emprestimos e
                            ON e.id = p.emprestimo_id

                        LEFT JOIN (
                            SELECT
                                pagamento_id,

                                COALESCE(
                                    SUM(
                                        CASE
                                            WHEN COALESCE(
                                                tipo,
                                                'Parcela'
                                            ) = 'Parcela'
                                            THEN
                                                valor_recebido
                                                + COALESCE(
                                                    desconto,
                                                    0
                                                )

                                            ELSE 0
                                        END
                                    ),
                                    0
                                ) AS total_aplicado

                            FROM recebimentos_parcelas

                            GROUP BY pagamento_id
                        ) recebido
                            ON recebido.pagamento_id = p.id

                        WHERE e.status = 'Ativo'
                        `,
                        [],
                        (erroSaldo, resultadoSaldo) => {

                            if (erroSaldo) {
                                console.error(
                                    "Erro ao calcular saldo:",
                                    erroSaldo
                                );

                                return res.status(500).json({
                                    erro:
                                        "Erro ao calcular o saldo das parcelas."
                                });
                            }

                            /*
                                4. MOVIMENTAÇÕES QUE NÃO ESTÃO
                                NA TABELA DE RECEBIMENTOS

                                Não incluímos Recebimento de Juros aqui,
                                porque ele já foi somado na tabela
                                recebimentos_parcelas.
                            */
                            db.all(
                                `
                                SELECT
                                    m.tipo,
                                    COALESCE(
                                        m.valor,
                                        0
                                    ) AS valor

                                FROM movimentacoes m

                                INNER JOIN emprestimos e
                                    ON e.id = m.emprestimo_id

                                WHERE
                                    e.status IN (
                                        'Ativo',
                                        'Quitado'
                                    )

                                    AND m.tipo IN (
                                        'Amortização',
                                        'Quitação'
                                    )
                                `,
                                [],
                                (
                                    erroMovimentacoes,
                                    movimentacoes
                                ) => {

                                    if (erroMovimentacoes) {
                                        console.error(
                                            "Erro ao consultar movimentações:",
                                            erroMovimentacoes
                                        );

                                        return res
                                            .status(500)
                                            .json({
                                                erro:
                                                    "Erro ao calcular as movimentações."
                                            });
                                    }

                                    const totalEmprestado =
                                        Number(
                                            resultadoEmprestimos
                                                .total_emprestado ||
                                            0
                                        );

                                    const totalRecebidoParcelasEJuros =
                                        Number(
                                            resultadoRecebimentos
                                                .total_recebido ||
                                            0
                                        );

                                    const totalQuitacoes =
                                        movimentacoes
                                            .filter(
                                                item =>
                                                    item.tipo ===
                                                    "Quitação"
                                            )
                                            .reduce(
                                                (
                                                    soma,
                                                    item
                                                ) =>
                                                    soma +
                                                    Number(
                                                        item.valor ||
                                                        0
                                                    ),
                                                0
                                            );

                                    const totalRecebido =
                                        totalRecebidoParcelasEJuros +
                                        totalQuitacoes;

                                    const totalReceberParcelas =
                                        Number(
                                            resultadoSaldo
                                                .total_receber_parcelas ||
                                            0
                                        );

                                    const totalAmortizado =
                                        movimentacoes
                                            .filter(
                                                item =>
                                                    item.tipo ===
                                                    "Amortização"
                                            )
                                            .reduce(
                                                (
                                                    soma,
                                                    item
                                                ) =>
                                                    soma +
                                                    Number(
                                                        item.valor ||
                                                        0
                                                    ),
                                                0
                                            );

                                    const totalReceber =
                                        Math.max(
                                            totalReceberParcelas -
                                            totalAmortizado,
                                            0
                                        );

                                    /*
                                        5. PARCELAS ATRASADAS

                                        Somente pagamentos do tipo Parcela
                                        reduzem o saldo considerado no atraso.
                                    */
                                    const hoje =
                                        new Date()
                                            .toISOString()
                                            .split("T")[0];

                                    db.get(
                                        `
                                        SELECT
                                            COUNT(*) AS quantidade

                                        FROM pagamentos p

                                        INNER JOIN emprestimos e
                                            ON e.id =
                                               p.emprestimo_id

                                        LEFT JOIN (
                                            SELECT
                                                pagamento_id,

                                                COALESCE(
                                                    SUM(
                                                        CASE
                                                            WHEN COALESCE(
                                                                tipo,
                                                                'Parcela'
                                                            ) = 'Parcela'

                                                            THEN
                                                                valor_recebido
                                                                +
                                                                COALESCE(
                                                                    desconto,
                                                                    0
                                                                )

                                                            ELSE 0
                                                        END
                                                    ),
                                                    0
                                                ) AS total_aplicado

                                            FROM recebimentos_parcelas

                                            GROUP BY pagamento_id
                                        ) recebido
                                            ON recebido.pagamento_id =
                                               p.id

                                        WHERE
                                            e.status = 'Ativo'

                                            AND p.vencimento < ?

                                            AND COALESCE(
                                                recebido.total_aplicado,
                                                0
                                            ) < p.valor - 0.009
                                        `,
                                        [hoje],
                                        (
                                            erroAtrasadas,
                                            resultadoAtrasadas
                                        ) => {

                                            if (erroAtrasadas) {
                                                console.error(
                                                    "Erro ao calcular parcelas atrasadas:",
                                                    erroAtrasadas
                                                );

                                                return res
                                                    .status(500)
                                                    .json({
                                                        erro:
                                                            "Erro ao calcular as parcelas atrasadas."
                                                    });
                                            }

                                            return res.json({
                                                totalEmprestado,
                                                totalRecebido,
                                                totalReceber,

                                                totalJurosRecebidos:
                                                    Number(
                                                        resultadoRecebimentos
                                                            .total_juros_recebidos ||
                                                        0
                                                    ),

                                                parcelasAtrasadas:
                                                    Number(
                                                        resultadoAtrasadas
                                                            .quantidade ||
                                                        0
                                                    )
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});
// ====================================
// CONSULTAR EXTRATO DO CONTRATO
// ====================================

app.get("/emprestimos/:id/extrato", (req, res) => {

    const emprestimoId = req.params.id;

    db.all(
        `
        SELECT
            id,
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor,
            saldo
        FROM extrato_contrato
        WHERE emprestimo_id = ?
        ORDER BY data ASC, hora ASC, id ASC
        `,
        [emprestimoId],
        (err, registros) => {

            if (err) {
                console.error("ERRO AO BUSCAR EXTRATO:", err);

                return res.status(500).json({
                    erro: "Não foi possível carregar o extrato.",
                    detalhes: err.message
                });
            }

            return res.json(registros);
        }
    );

});

app.listen(3001, () => {
    console.log("Servidor rodando na porta 3001");
});