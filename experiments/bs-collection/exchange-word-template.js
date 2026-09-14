/* Bill of Exchange body measured against the supplied September 2026 Word/PDF.
   Branding and stamp remain supplied by the existing collection renderer. */
window.CollectionExchangeWordTemplate = {
  config(){
    return {version:1,header:'collection',unit:'mm',top:54.9,bottom:28,left:19.9,right:20.1,headerSize:0,footerSize:0,html:`
<style>
.bank-exchange{font-family:Calibri,'Jahez Exchange Sans',sans-serif;font-size:14pt;line-height:17.1pt;color:#000;text-align:left}
.bank-exchange *{box-sizing:border-box}
.bank-exchange h2{font-family:'Times New Roman','Liberation Serif',serif;font-size:12pt;line-height:14pt;font-weight:bold;text-align:center;margin:0 0 8.6mm}
.bank-exchange .exchange-meta{width:135mm;table-layout:fixed;margin:0 auto 6mm;font-family:'Times New Roman','Liberation Serif',serif;font-size:12pt;font-weight:bold}
.bank-exchange .exchange-meta td{border:.5pt solid #000;height:14.7mm;padding:2mm;text-align:center;vertical-align:middle}
.bank-exchange .exchange-order{padding-left:1.75mm}
.bank-exchange .exchange-order p{margin:0;line-height:17.1pt}
.bank-exchange .exchange-invoices{width:auto;margin:6.1mm 0 0 3.65mm;font-size:14pt;line-height:17.1pt}
.bank-exchange .exchange-invoices td{border:0;padding:0 3.5mm 0 0;vertical-align:top}
.bank-exchange .exchange-invoices td:first-child{min-width:40.6mm;max-width:85mm;overflow-wrap:anywhere}
.bank-exchange .exchange-invoices td:nth-child(2){font-weight:bold;white-space:nowrap}
.bank-exchange .exchange-invoices td:last-child{white-space:nowrap}
.bank-exchange .exchange-main{min-height:76.6mm}
.bank-exchange .exchange-party{border-top:1.5pt solid #a6a6a6;padding:1.2mm 1.75mm 0;break-inside:avoid}
.bank-exchange .exchange-drawn{min-height:41.3mm}
.bank-exchange .exchange-party-label{font-family:PMingLiU,PMingLiU-ExtB,'Times New Roman','Liberation Serif',serif;font-size:14pt;line-height:17.1pt}
.bank-exchange .exchange-party-name{font-size:14pt;font-weight:bold;line-height:17.1pt}
.bank-exchange .exchange-party-address{font-size:11pt;font-weight:bold;line-height:14pt;white-space:pre-line}
</style>
<section class="bank-exchange" dir="ltr">
<h2>BILL OF EXCHANGE</h2>
<table class="exchange-meta"><tbody><tr><td>Amount: {{exchangeAmount}}</td><td>DATED: {{exchangeCollectionDate}}</td></tr></tbody></table>
<div class="exchange-main">
<div class="exchange-order"><p><b>AT {{term}} PAY TO THE ORDER OF</b></p><p><u>{{exchangeBank}}, ABU DHABI – UAE</u>&nbsp; A SUM OF&nbsp; <b>{{exchangeAmount}}</b></p><p>{{exchangeWords}}&nbsp; <b>BEING VALUE DRAWN UNDER INVOICE #</b></p></div>
<table class="exchange-invoices" aria-label="Invoice references"><tbody>{{#each exchangeRows}}<tr><td>{{invoiceNo}}</td><td>Dated:</td><td>{{exchangeInvoiceDate}}</td></tr>{{/each}}</tbody></table>
</div>
<div class="exchange-party exchange-drawn"><div class="exchange-party-label">Drawn On</div><div class="exchange-party-name">{{drawee}}</div><div class="exchange-party-address">{{draweeAddress}}</div></div>
<div class="exchange-party"><div class="exchange-party-label">Drawer</div><div class="exchange-party-name">{{drawer}}</div><div class="exchange-party-address">307, ALWAHA 1 DEIRA, DUBAI - UAE +97145773892</div></div>
</section>`};
  },
  fonts(origin){
    // Calibri is used when installed; Carlito supplies compatible metrics on the PDF host.
    return [400,700].map(weight=>`@font-face{font-family:'Jahez Exchange Sans';font-style:normal;font-weight:${weight};src:url('${origin}/experiments/bs-collection/assets/Carlito-${weight===700?'Bold':'Regular'}.ttf') format('truetype');}`).join('');
  }
};
