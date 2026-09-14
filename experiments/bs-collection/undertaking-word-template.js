/* Undertaking body measured against the supplied Word/PDF.
   The collection renderer continues to supply the existing letterhead and stamp. */
window.CollectionUndertakingWordTemplate = {
  config(){
    return {version:1,header:'collection',unit:'mm',top:46.5,bottom:22,left:10,right:10,headerSize:0,footerSize:0,html:`
<style>
.bank-undertaking{font-family:Cambria,'Times New Roman',serif;font-size:10pt;line-height:11.75pt;color:#000;text-align:left;font-kerning:none;text-rendering:geometricPrecision}
.bank-undertaking *{box-sizing:border-box}
.bank-undertaking p{margin:0}
.bank-undertaking .undertaking-head{line-height:12.7pt}
.bank-undertaking .undertaking-first{display:grid;grid-template-columns:101.6mm minmax(0,1fr)}
.bank-undertaking .undertaking-date b{font-family:Calibri,sans-serif;font-size:11pt}
.bank-undertaking .undertaking-address{white-space:pre-line;line-height:11.75pt}
.bank-undertaking h2{font-family:Cambria,'Times New Roman',serif;font-size:10pt;font-weight:bold;line-height:11.75pt;text-align:center;margin:4.1mm 0 0}
.bank-undertaking .undertaking-refs{width:auto;max-width:calc(100% - 49.1mm);margin:0 0 0 49.1mm;font-size:10pt;font-weight:bold;line-height:11.75pt}
.bank-undertaking .undertaking-refs td{border:0;padding:0 2.1mm;text-align:center;vertical-align:top;overflow-wrap:anywhere}
.bank-undertaking .undertaking-refs td:first-child{padding-left:0;text-align:left;white-space:nowrap}
.bank-undertaking .undertaking-highlight{background:#ff0;color:#000;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.bank-undertaking .undertaking-dear{margin:25.4mm 0 5.1mm}
.bank-undertaking .undertaking-terms{list-style:none;counter-reset:undertaking-term;margin:0;padding:0 0 0 6.35mm}
.bank-undertaking .undertaking-terms li{position:relative;counter-increment:undertaking-term;margin:0;padding:0;text-align:justify;line-height:11.75pt}
.bank-undertaking .undertaking-terms li::before{content:counter(undertaking-term) '.';position:absolute;left:-6.35mm;font-weight:bold}
.bank-undertaking sup{font-size:6.5pt;line-height:0;vertical-align:super}
.bank-undertaking .undertaking-signature{margin-top:2.8mm;break-inside:avoid}
.bank-undertaking .undertaking-signature p{margin-bottom:3.15mm}
.bank-undertaking .undertaking-signer{width:auto;margin:0;line-height:11.75pt}
.bank-undertaking .undertaking-signer td{border:0;padding:0;text-align:left;vertical-align:top}
.bank-undertaking .undertaking-signer td:first-child{width:25.4mm}
.bank-undertaking .undertaking-signature .undertaking-sign-label{margin:8.2mm 0 0}
.bank-undertaking .undertaking-footnote-rule{border:0;border-top:.5pt solid #000;width:50.8mm;margin:12.4mm 0 0}
</style>
<section class="bank-undertaking" dir="ltr">
<div class="undertaking-head"><div class="undertaking-first"><span>THE MANAGER</span><span class="undertaking-date">Dated : <b>{{exchangeCollectionDate}}</b></span></div><div>TRADE FINANCE DEPARTMENT</div><div>{{exchangeBank}}</div><div class="undertaking-address">{{undertakingBankAddress}}</div></div>
<h2>UNDERTAKING LETTER UNDER Export Collection Docs</h2>
<table class="undertaking-refs"><tbody>{{#each undertakingRows}}<tr><td>{{referenceLabel}}</td><td><span class="undertaking-highlight">{{invoiceNo}}</span></td><td><span class="undertaking-highlight">{{billNo}}</span></td><td><span class="undertaking-highlight">{{referenceCurrency}}</span></td><td><span class="undertaking-highlight">{{referenceAmount}}</span></td></tr>{{/each}}</tbody></table>
<p class="undertaking-dear">Dear Sir / Madam,</p>
<ol class="undertaking-terms">
<li>We hereby certify to {{remittingBank}} PJSC (the “<b><u>Bank</u></b>”) that all enclosed Documents and any other document in relation to the underlying shipment or goods as described in the enclosed documents are accurate, correct and complete documents in full force and effect at the date of this letter.</li>
<li>[We hereby acknowledge that we have submitted <b class="undertaking-highlight">{{billOfLadingType}}</b> and certify that the Bank is the only bank handling the collection as the remitting bank and that we have not submitted (nor will we submit) the above Documents as a duplicate presentation to any other bank inside or outside the United Arab Emirates. The Bank may take any action which the Bank considers, in its sole and absolute discretion, required or appropriate to comply with laws, regulations, sanctions regimes, international guidance, the Bank's policies and procedures and/or requests of courts or regulatory authorities relating to the detection and prevention of money laundering and terrorism financing.]]<sup>1</sup></li>
<li>The Bank shall be under no obligation to make any payment to us as seller/exporter/drawer in respect of the collection until it has received full payment from the collecting/presenting bank.</li>
<li>The Bank is entitled to deduct any charges for it services rendered under this letter.</li>
<li>The Bank is not obliged to check the Documents before sending them to the collecting/presenting bank.</li>
<li>The Bank shall not be liable for any losses or damages arising out of any delay or failure by the Bank in performing its services under this letter.</li>
<li>We hereby agree to indemnify the Bank and hold it harmless against all actions, proceedings and claims brought or threatened against it, and against all losses, damages, costs and expenses (including legal or attorney's fees) relating thereto, where such actions, proceedings, claims, losses, damages, costs and expenses have arisen out of or are in connection with our instruction under this letter <span class="undertaking-highlight">including us submitting “<b>{{billOfLadingType}}</b>” as transport document(s).</span></li>
<li>We hereby agree that the collection documents will be handled in accordance with the Uniform Rules for Collections, ICC publication number 522 (URC 522) or any subsequent revision thereof to the extent these rules are consistent with the federal laws of the United Arab Emirates and the laws of the Emirate of Abu Dhabi and with the rules and principles Islamic Shariah as interpreted by the Internal Shariah Supervisory Committee of the Bank.</li>
</ol>
<div class="undertaking-signature"><p>Sincerely,</p><p>For and on behalf of:</p><p><b>{{drawer}}</b></p><table class="undertaking-signer"><tbody><tr><td>Name:</td><td>{{authorizedPerson}}</td></tr><tr><td>Title:</td><td>{{title}}</td></tr></tbody></table><p class="undertaking-sign-label">Signature:</p><hr class="undertaking-footnote-rule"></div>
</section>`};
  }
};
