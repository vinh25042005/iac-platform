output "master_public_ip" {
  value = aws_instance.node[var.master_node_index].public_ip
}

output "node_instance_ids" {
  value = aws_instance.node[*].id
}

output "node_private_ips" {
  value = aws_instance.node[*].private_ip
}

output "node_public_ips" {
  value = aws_instance.node[*].public_ip
}

output "inventory_file" {
  value = local_file.ansible_inventory.filename
}
