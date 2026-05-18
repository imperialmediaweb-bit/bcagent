import * as XLSX from "xlsx";
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"], [1]]), "S");
const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
console.log("typeof:", typeof buf);
console.log("constructor:", buf?.constructor?.name);
console.log("length:", buf?.length);
console.log("byteLength:", buf?.byteLength);
