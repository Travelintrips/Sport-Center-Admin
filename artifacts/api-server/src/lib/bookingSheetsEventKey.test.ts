import { describe,it,expect } from "vitest";
import {bookingSheetsEventKey,bookingSheetsPaidTab} from "./bookingSheetsEventKey";
describe("Google Sheets booking payment identity",()=>{
 it("separates DP and settlement for one booking",()=>{
  expect(bookingSheetsEventKey({kind:"direct",paymentId:11,bookingId:6})).not.toBe(bookingSheetsEventKey({kind:"direct",paymentId:12,bookingId:6}));
 });
 it("separates allocations within one group payment",()=>{
  expect(bookingSheetsEventKey({kind:"allocation",paymentId:13,allocationId:21,bookingId:6})).not.toBe(bookingSheetsEventKey({kind:"allocation",paymentId:13,allocationId:22,bookingId:7}));
 });
 it("separates invoice items for one company invoice",()=>{
  expect(bookingSheetsEventKey({kind:"corporate",invoiceId:9,invoiceItemId:2,bookingId:6})).not.toBe(bookingSheetsEventKey({kind:"corporate",invoiceId:9,invoiceItemId:3,bookingId:7}));
 });
 it("rejects invalid ids",()=>expect(()=>bookingSheetsEventKey({kind:"direct",paymentId:0,bookingId:1})).toThrow());
 it("routes on WIB payment date not booking date",()=>{
  expect(bookingSheetsPaidTab("2026-10-31T17:01:00Z")).toBe("PAID NOVEMBER 2026");
  expect(bookingSheetsPaidTab("2026-10-26T01:00:00Z")).toBe("PAID OKTOBER 2026");
 });
});
