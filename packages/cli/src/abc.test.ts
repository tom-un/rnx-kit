import { foo } from "./abc";

describe("abc tests", () => {
  test("object matches snapshot", () => {
    const o = {
      name: "abc test",
      message: foo(),
    };
    expect(o).toMatchSnapshot();
  });
});
