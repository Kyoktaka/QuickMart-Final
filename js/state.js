/* QuickMart page state: PHP/MySQL APIs are the source of truth. */
const TIMEOUT=300,LOW=10;
let resetFromLogin=false,authPasswordOnly=false;
const state={manager:null,products:[],tags:[],sessions:[],dashboard:null,activity:[],
  cart:[],current:null,authCb:null,kioskOn:false,scanner:null,scanning:false,processing:false};
