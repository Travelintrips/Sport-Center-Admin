import { classifyX904AdmsRequest } from "./x904AdmsProtocol";
describe("X904 ADMS compatibility gate", () => {
  it("recognizes only candidate iClock requests", () => {
    expect(classifyX904AdmsRequest("GET", "/iclock/cdata?SN=TEST_1234&options=all")).toEqual({kind:"handshake",serial:"TEST_1234"});
    expect(classifyX904AdmsRequest("GET", "/iclock/getrequest?SN=TEST_1234")).toEqual({kind:"poll",serial:"TEST_1234"});
    expect(classifyX904AdmsRequest("POST", "/iclock/cdata?SN=TEST_1234&table=ATTLOG")).toEqual({kind:"attendance",serial:"TEST_1234"});
  });
  it("rejects unsafe serial and non-attendance exports", () => {
    expect(classifyX904AdmsRequest("POST", "/iclock/cdata?SN=../../&table=ATTLOG").kind).toBe("reject");
    expect(classifyX904AdmsRequest("POST", "/iclock/cdata?SN=TEST_1234&table=BIODATA").kind).toBe("reject");
    expect(classifyX904AdmsRequest("POST", "/iclock/cdata?SN=TEST_1234&table=USER").kind).toBe("reject");
  });
});
