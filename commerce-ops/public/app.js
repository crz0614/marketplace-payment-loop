import { CHANNELS } from "../src/domain.mjs";
const root=document.querySelector("#channels");
for(const [key,value] of Object.entries(CHANNELS)){const article=document.createElement("article");article.innerHTML=`<h3>${value.label}</h3><p>${value.api}</p><span>官方导出导入可用 · API 待商家授权</span>`;article.dataset.channel=key;root.append(article)}
