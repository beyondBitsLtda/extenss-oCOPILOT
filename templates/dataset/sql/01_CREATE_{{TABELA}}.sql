/* =============================================================================
   01_CREATE_{{TABELA}}.sql - tabela do dataset {{DATASET}}
   {{TITULO}} DELP
   -----------------------------------------------------------------------------
   O que faz : cria a tabela se ainda nao existir (idempotente).
   Como usar : rode em HOMOLOGACAO primeiro. Base {{BASE}} (a mesma usada pelos
               datasets do projeto, via datasource {{DS_JNDI}}).
   Escreve?  : sim (DDL). Nao apaga nada.
   v1.0 - {{DATA}} - criacao (gerado pelo modelo padrao Delp)
============================================================================= */

IF OBJECT_ID('{{BASE}}.dbo.{{TABELA}}', 'U') IS NULL
BEGIN
    CREATE TABLE {{BASE}}.dbo.{{TABELA}} (
        ID             INT IDENTITY(1,1) NOT NULL,
        CODIGO         NVARCHAR(50)      NOT NULL,
        NOME           NVARCHAR(200)     NOT NULL,
        VALOR          DECIMAL(18,2)     NULL,
        ATIVO          BIT               NOT NULL CONSTRAINT DF_{{TABELA}}_ATIVO DEFAULT (1),
        RECCREATEDBY   NVARCHAR(100)     NULL,
        RECCREATEDON   DATETIME2(0)      NOT NULL CONSTRAINT DF_{{TABELA}}_CRIADO DEFAULT (SYSDATETIME()),
        RECMODIFIEDBY  NVARCHAR(100)     NULL,
        RECMODIFIEDON  DATETIME2(0)      NULL,
        CONSTRAINT PK_{{TABELA}} PRIMARY KEY (ID)
    );
    PRINT '{{TABELA}} criada.';
END
ELSE
    PRINT '{{TABELA}} ja existe - nada a fazer.';
GO
