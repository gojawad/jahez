(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.JahezBsgtOperationsDisplay=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const codes='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
  const normalize=value=>String(value??'').trim().normalize('NFKC').toLowerCase().replace(/[.\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/\s+/g,' ');
  const names=new Map(codes.map(code=>[normalize(code),code]));
  // Use the browser's country names, not shipment-specific flags or saved values.
  if(typeof Intl.DisplayNames==='function')for(const locale of ['en','ar']){
    const regions=new Intl.DisplayNames([locale],{type:'region'});
    codes.forEach(code=>names.set(normalize(regions.of(code)),code));
  }
  const aliases={AE:['UAE','U.A.E.','ARE','الإمارات','الامارات العربية المتحدة'],CN:['CHN','PRC','P.R. China','People\'s Republic of China','جمهورية الصين الشعبية'],EG:['EGY','جمهورية مصر العربية'],IN:['IND'],GB:['UK','GBR','Britain','Great Britain','بريطانيا'],US:['USA','United States of America','امريكا'],SA:['KSA','SAU','السعودية'],SD:['SDN'],TR:['Turkey','TUR'],KR:['Korea','Republic of Korea','KOR'],VN:['Viet Nam','VNM'],RU:['Russian Federation','RUS']};
  Object.entries(aliases).forEach(([code,values])=>values.forEach(value=>names.set(normalize(value),code)));
  function countryCode(value){return names.get(normalize(value))||'';}
  function originCode(record){return countryCode(record.countryOriginCode)||countryCode(record.originCountryCode)||countryCode(record.countryOfOriginCode)||countryCode(record.countryOrigin||record.countryOfOrigin);}
  function destinationCode(record){
    const explicit=record.destinationCountryCode||record.countryDestinationCode||record.portDischargeCountryCode||record.destinationCountry||record.countryDestination||record.portDischargeCountry;
    if(String(explicit??'').trim())return countryCode(explicit);
    // Only unambiguous legacy port names are used when no destination country exists.
    return ['port sudan','port sudan, sudan','بورتسودان','بورت سودان','ميناء بورتسودان','ميناء بورت سودان'].includes(normalize(record.portDischarge))?'SD':'';
  }
  return Object.freeze({countryCode,originCode,destinationCode});
});
