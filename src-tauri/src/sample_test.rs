#[cfg(test)]
mod tests {
    #[test]
    fn test_basic_assertion() {
        assert_eq!(1 + 1, 2);
    }

    #[test]
    fn test_string_operations() {
        let s = "ProjectLens";
        assert!(s.contains("Lens"));
        assert_eq!(s.len(), 11);
    }

    #[test]
    fn test_vector_operations() {
        let v = vec![1, 2, 3];
        assert_eq!(v.len(), 3);
        assert!(v.contains(&2));
    }

    #[test]
    fn test_option_some() {
        let some_value: Option<i32> = Some(42);
        assert!(some_value.is_some());
        assert_eq!(some_value.unwrap(), 42);
    }

    #[test]
    fn test_option_none() {
        let none_value: Option<i32> = None;
        assert!(none_value.is_none());
    }
}
