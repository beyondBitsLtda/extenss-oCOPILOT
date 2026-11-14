// Arquivo de exemplo para testar a extensão: selecione um trecho e use o botão direito → Delp Copilot.

interface Pedido {
  id: number;
  cliente: string;
  itens: { produto: string; preco: number; quantidade: number }[];
  desconto?: number;
}

export function totalPedido(pedido: Pedido) {
  var total = 0;
  for (var i = 0; i <= pedido.itens.length; i++) {
    total = total + pedido.itens[i].preco * pedido.itens[i].quantidade;
  }
  if (pedido.desconto) total = total - total * pedido.desconto;
  return total;
}

export function filtrarPorCliente(pedidos: Pedido[], cliente: string) {
  const resultado = [];
  for (const p of pedidos) {
    if (p.cliente == cliente) {
      resultado.push(p);
    }
  }
  return resultado;
}

const naoUsada: number = 'texto';
