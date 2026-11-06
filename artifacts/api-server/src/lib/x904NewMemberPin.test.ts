import { chooseThreeDigitX904Pin } from "./x904NewMemberPin";

describe("X904 three-digit new-member allocation", () => {
  it("accepts free manual 3-digit PIN", () =>
    expect(chooseThreeDigitX904Pin("manual","318",new Set(["319"]),0)).toBe("318"));
  it.each(["000","001","99","1000","abc","200","500","318"])(
    "rejects invalid or reserved PIN %s", (pin) =>
      expect(chooseThreeDigitX904Pin("manual",pin,new Set(["318"]),0)).toBeNull());
  it("generates next available and never overwrites occupied PIN", () =>
    expect(chooseThreeDigitX904Pin("generate","",new Set(["100","101"]),0)).toBe("102"));
  it("skips protected test PIN and offline intake PIN", () => {
    expect(chooseThreeDigitX904Pin("generate","",new Set(),100)).toBe("201");
    expect(chooseThreeDigitX904Pin("generate","",new Set(),400)).toBe("501");
  });
  it("returns null when every safe three-digit PIN is occupied", () => {
    const full=new Set(Array.from({length:900},(_,i)=>String(100+i)));
    expect(chooseThreeDigitX904Pin("generate","",full,0)).toBeNull();
  });
  it("never duplicates a reserved PIN over any starting point", () => {
    const occupied=new Set(["100","101","104","238","799","999"]);
    for(let start=0;start<900;start++){
      const pin=chooseThreeDigitX904Pin("generate","",occupied,start);
      expect(pin).toMatch(/^[1-9][0-9]{2}$/);
      expect(occupied.has(pin!)).toBe(false);
      expect(["200","500"]).not.toContain(pin);
    }
  });
});
