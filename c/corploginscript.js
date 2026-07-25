// Google Corp Login Script - Stub
function fillMiField(){}
function loginOnload(){}
function setWarningParams(){}
function setDisableGnubbyCookie(){document.cookie="disableGnubby=1;path=/";window.location=this.href}
function toggleInput(toggleId,rowId,inputId,tabIndex1,tabIndex2){
  var row=document.getElementById(rowId);
  var toggle=document.getElementById(toggleId);
  var input=document.getElementById(inputId);
  if(row.style.display==='none'){
    row.style.display='';
    toggle.textContent='[-]';
    input.tabIndex=tabIndex1;
  }else{
    row.style.display='none';
    toggle.textContent='[+]';
    input.tabIndex=tabIndex2;
  }
}
