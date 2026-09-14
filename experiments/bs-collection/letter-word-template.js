/* Collection instruction body from the supplied Word/PDF.
   Amounts, banks and parties remain bound to the existing collection settings. */
window.CollectionLetterWordTemplate = {
  config(){
    return {version:1,header:'collection',unit:'mm',top:51.3,bottom:25,left:12.7,right:12.7,headerSize:0,footerSize:0,html:`
<style>
.bank-collection-letter{font-family:'Times New Roman','Liberation Serif',serif;font-size:12pt;line-height:13.8pt;color:#000;text-align:left;font-kerning:none}
.bank-collection-letter *{box-sizing:border-box}
.bank-collection-letter p{margin:0}
.bank-collection-letter .letter-date{margin-bottom:4.1mm}
.bank-collection-letter .letter-date b{font-family:Calibri,sans-serif;font-size:11pt}
.bank-collection-letter .letter-recipient{margin-bottom:3.25mm;white-space:pre-line}
.bank-collection-letter .letter-dear{margin-bottom:3.25mm}
.bank-collection-letter .letter-instructions{text-align:justify;margin-bottom:4.5mm}
.bank-collection-letter .letter-charges{margin-bottom:3.3mm;font-weight:bold}
.bank-collection-letter .letter-charges span{font-family:Garamond,'Times New Roman',serif}
.bank-collection-letter .letter-amount{line-height:15pt;margin-bottom:3.1mm}
.bank-collection-letter .letter-amount-number{font-family:Calibri,sans-serif;font-size:14pt;font-weight:bold}
.bank-collection-letter .letter-tenor{margin-bottom:4mm}
.bank-collection-letter .letter-bank{margin-bottom:3.2mm}
.bank-collection-letter .letter-bank-name{display:block;margin-top:.65mm}
.bank-collection-letter .letter-bank-address{display:block;font-family:Calibri,sans-serif;font-size:11pt;font-style:italic;margin-top:.7mm;white-space:pre-line}
.bank-collection-letter .letter-drawee{margin-bottom:4.1mm}
.bank-collection-letter .letter-drawee-name{display:block;font-family:Calibri,sans-serif;font-size:12pt;font-weight:bold;margin-top:.3mm}
.bank-collection-letter .letter-drawee-address{display:block;font-family:Calibri,sans-serif;font-size:12pt;font-style:italic;margin-top:.3mm;white-space:pre-line}
.bank-collection-letter .letter-documents{width:108mm;table-layout:fixed;font-size:12pt;line-height:13.8pt;margin:0}
.bank-collection-letter .letter-documents td,.bank-collection-letter .letter-documents th{border:0;padding:0;text-align:left;font-weight:normal;vertical-align:top}
.bank-collection-letter .letter-documents th{font-weight:bold}
.bank-collection-letter .letter-documents td:nth-child(n+3),.bank-collection-letter .letter-documents th:nth-child(n+3){text-align:center}
.bank-collection-letter .letter-swift{font-family:'IBM Plex Sans Arabic Medium','IBM Plex Sans Arabic',sans-serif;font-size:10pt;font-weight:500;line-height:12pt;margin-top:.9mm}
.bank-collection-letter .letter-swift span{background:#ff0;color:#000;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.bank-collection-letter .letter-signature{break-inside:avoid;margin-top:1mm}
.bank-collection-letter .letter-faithfully{margin-bottom:2.45mm}
.bank-collection-letter .letter-author{font-family:Tahoma,sans-serif;font-size:12pt;margin:2.65mm 0 0 12.7mm}
.bank-collection-letter .letter-title{font-family:'IBM Plex Sans Arabic SemiBold','IBM Plex Sans Arabic',sans-serif;font-size:12pt;font-weight:600;margin:1.4mm 0 0 25.4mm}
</style>
<section class="bank-collection-letter" dir="ltr">
<p class="letter-date">Date: <b>{{exchangeCollectionDate}}</b></p>
<p class="letter-recipient">The Manager<br>{{remittingBank}}<br>Trade Finance Department<br>{{remittingBankLetterAddress}}</p>
<p class="letter-dear">Dear sir,</p>
<p class="letter-instructions">We enclose herewith the following documents and request you to forward the same to collecting bank without any responsibility on your part requesting them to release the documents to drawee only against their <b>acceptance for payment on due date</b> without any responsibility on collecting bank and {{remittingBank}}’s part and only upon receipt of funds from them, please credit the proceeds to our account no <b>{{remittingBankAccountNo}}</b> held with you after deduction of your charges under advice to us.</p>
<p class="letter-charges">All bank charges outside UAE are to be collected from <span>buyer/drawee</span></p>
<p>COLLECTION DOCUMENTS for:</p>
<p class="letter-amount">Amount: <b>{{currency}}</b>&nbsp; <span class="letter-amount-number">{{total}}</span> SAY: <b>{{exchangeWords}}</b>.</p>
<p class="letter-tenor">Tenor: <b>{{letterTenor}}</b></p>
<p class="letter-bank">COLLECTING BANK<b class="letter-bank-name">{{collectingBank}}</b><i class="letter-bank-address">{{collectingBankAddress}}</i></p>
<p class="letter-drawee">DRAWEE.<b class="letter-drawee-name">{{drawee}}</b><i class="letter-drawee-address">{{draweeAddress}}</i></p>
<p>DOCUMENTS ENCLOSED:</p>
<table class="letter-documents"><colgroup><col style="width:7.5mm"><col style="width:65mm"><col style="width:18mm"><col style="width:17.5mm"></colgroup><thead><tr><th>No</th><th>Type of Document</th><th>Original</th><th>Duplicate</th></tr></thead><tbody><tr><td>1</td><td>BILL OF EXCHANGE</td><td>1</td><td>0</td></tr><tr><td>2</td><td>COMMERCIAL INVOICE</td><td>2</td><td>0</td></tr><tr><td>3</td><td>COPY B/L</td><td>0</td><td>2</td></tr><tr><td>4</td><td>Certificate of Origin</td><td>2</td><td>0</td></tr></tbody></table>
<p class="letter-swift"><span>{{billBy}}</span></p>
<div class="letter-signature"><p>.</p><p class="letter-faithfully">Yours faithfully,</p><p>For and on behalf of<br>{{drawer}}</p><div class="letter-author">{{authorizedPerson}}</div><div class="letter-title">{{title}}</div></div>
</section>`};
  }
};
