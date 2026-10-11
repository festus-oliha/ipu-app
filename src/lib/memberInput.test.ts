import { describe, expect, it } from "vitest";
import { nextMemberNo, parseMemberForm } from "./memberInput";
import { displayPhone, normalizePhone } from "./phone";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("phone numbers", () => {
  it("accepts the ways members write them", () => {
    for (const p of ["0803 445 3367", "08034453367", "2348034453367", "+234 803 445 3367", "+234-803-445-3367"]) {
      expect(normalizePhone(p)).toBe("+2348034453367");
    }
  });
  it("rejects numbers that are not Nigerian mobiles", () => {
    for (const p of ["", "0803445336", "12345678901", "+44 7700 900123", "0603 445 3367"]) {
      expect(normalizePhone(p)).toBeNull();
    }
  });
  it("shows them the familiar way", () => expect(displayPhone("+2349076729480")).toBe("0907 672 9480"));
});

describe("member numbers", () => {
  it("starts at IPU-0001 and follows the highest", () => {
    expect(nextMemberNo([])).toBe("IPU-0001");
    expect(nextMemberNo(["IPU-0001", "IPU-0010", "IPU-0003"])).toBe("IPU-0011");
  });
});

describe("member form", () => {
  it("reads a good form", () => {
    const { errors, data } = parseMemberForm(
      form({ title: "Mrs", fullName: " Felicia Imade ", phone: "0804 445 3367", usualMonthly: "20,000", accountNumber: "1234 567 890", yearJoined: "2011" }),
    );
    expect(errors).toEqual({});
    expect(data).toMatchObject({ title: "Mrs", fullName: "Felicia Imade", phone: "+2348044453367", usualMonthlyKobo: 2000000n, accountNumber: "1234567890", yearJoined: 2011, email: null, status: "ACTIVE" });
  });
  it("explains each problem in plain words", () => {
    const { errors } = parseMemberForm(form({ fullName: "A", phone: "123", usualMonthly: "ten", accountNumber: "123", email: "no-at-sign", yearJoined: "1800" }));
    expect(Object.keys(errors).sort()).toEqual(["accountNumber", "email", "fullName", "phone", "usualMonthly", "yearJoined"]);
    expect(errors.phone).toMatch(/Nigerian phone number/);
  });
});
